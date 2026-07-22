import { createHash, randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
  type FileHandle,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DomainError } from '../core/domainError';
import {
  assertExpandedConfig,
  assertNoAliasConflict,
  ensureManagedInclude,
  renderKnownHosts,
  renderManagedConfig,
} from '../domain/sshConfig';
import type { ServerProfile } from '../domain/profiles';
import type { WindowsFileAcl } from '../platform/windows/fileAcl';
import type { OpenSshTools } from '../platform/windows/openssh';
import type { ProcessRunner } from '../platform/windows/processRunner';

export interface SshConfigPaths {
  readonly userConfig: string;
  readonly managedDirectory: string;
  readonly managedConfig: string;
  readonly knownHosts: string;
  readonly managedState: string;
}

export interface ConfigPreflightResult {
  readonly ok: true;
  readonly recovery: 'none' | 'preview-2';
}

export interface ProjectedManagedHost {
  readonly alias: string;
  readonly id: string;
}

type ProfileSource = readonly ServerProfile[] | (() => readonly ServerProfile[]);

interface ManagedFileStateV1 {
  readonly schemaVersion: 1;
  readonly authorityHash?: string;
  readonly managedConfigHash: string;
  readonly knownHostsHash: string;
}

interface ManagedSnapshot {
  readonly existingKnownHosts: Buffer | undefined;
  readonly existingManagedConfig: Buffer | undefined;
  readonly stateSource: Buffer | undefined;
  readonly state: ManagedFileStateV1 | undefined;
  readonly recovery: ConfigPreflightResult['recovery'];
}

interface ManagedLock {
  readonly handle: FileHandle;
  readonly path: string;
  readonly token: string;
}

interface CommitRollback {
  readonly knownHosts: { readonly before: Buffer | undefined; readonly after: Buffer };
  readonly managedConfig: { readonly before: Buffer | undefined; readonly after: Buffer };
  readonly userConfig?: { readonly before: Buffer | undefined; readonly after: Buffer };
}

export class SshConfigService {
  public constructor(
    private readonly runner: ProcessRunner,
    private readonly acl: WindowsFileAcl,
    private readonly authorityHash: string,
  ) {}

  public resolvePaths(configFileSetting?: string): SshConfigPaths {
    const sshDirectory = path.join(os.homedir(), '.ssh');
    const userConfig =
      configFileSetting === undefined || configFileSetting.trim().length === 0
        ? path.join(sshDirectory, 'config')
        : path.resolve(expandHome(configFileSetting.trim()));
    const managedDirectory = path.join(path.dirname(userConfig), 'ssh-onboard');
    return {
      userConfig,
      managedDirectory,
      managedConfig: path.join(managedDirectory, 'config'),
      knownHosts: path.join(managedDirectory, 'known_hosts'),
      managedState: path.join(managedDirectory, 'state.json'),
    };
  }

  public async preflight(
    source: ProfileSource,
    paths: SshConfigPaths,
    projectedHost?: ProjectedManagedHost,
  ): Promise<ConfigPreflightResult> {
    await this.assertManagedDirectorySafeOrMissing(paths.managedDirectory);
    await this.assertRegularOrMissing(paths.userConfig);
    await this.assertManagedFilesSafe(paths);
    await this.assertLockIsAbsent(paths);

    const profiles = readProfiles(source);
    const desiredKnownHosts = Buffer.from(renderKnownHosts(profiles), 'utf8');
    const desiredManagedConfig = Buffer.from(
      renderManagedConfig(profiles, paths.knownHosts),
      'utf8',
    );
    const userSource = (await readOptional(paths.userConfig)) ?? Buffer.alloc(0);
    ensureManagedInclude(userSource, paths.managedConfig);
    assertNoAliasConflict(userSource, managedAliases(profiles, projectedHost));
    const snapshot = await this.inspectManagedSnapshot(
      paths,
      desiredKnownHosts,
      desiredManagedConfig,
    );
    return { ok: true, recovery: snapshot.recovery };
  }

  /**
   * Lightweight, read-only validation for the Add/Edit form. Full managed
   * file, ACL, lock, and state checks remain mandatory at Save and Initialize.
   */
  public async preflightAlias(
    source: ProfileSource,
    paths: SshConfigPaths,
    projectedHost: ProjectedManagedHost,
  ): Promise<void> {
    await this.assertRegularOrMissing(paths.userConfig);
    const userSource = (await readOptional(paths.userConfig)) ?? Buffer.alloc(0);
    ensureManagedInclude(userSource, paths.managedConfig);
    assertNoAliasConflict(userSource, managedAliases(readProfiles(source), projectedHost));
  }

  public async apply(
    source: ProfileSource,
    target: ServerProfile & Required<Pick<ServerProfile, 'localKey'>>,
    tools: OpenSshTools,
    paths: SshConfigPaths,
  ): Promise<void> {
    await this.synchronize(source, paths);
    const expanded = await this.expandConfig(tools, paths, target.alias);
    assertExpandedConfig(expanded.stdout, target, paths.knownHosts);
  }

  /**
   * Persist confirmed host keys without activating any new managed Host block
   * or changing the user's SSH config. On the first trust operation this
   * creates an empty managed config, writes known_hosts, and commits state
   * last while holding one managed lock.
   */
  public async persistKnownHosts(source: ProfileSource, paths: SshConfigPaths): Promise<void> {
    await this.acl.ensureRestrictedDirectory(paths.managedDirectory);
    await this.assertRegularOrMissing(paths.managedConfig);
    await this.assertRegularOrMissing(paths.knownHosts);
    await this.assertRegularOrMissing(paths.managedState);
    const lock = await this.acquireManagedLock(paths);
    let rollback: CommitRollback | undefined;
    try {
      await this.assertManagedFilesSafe(paths);
      const profiles = readProfiles(source);
      const desiredKnownHosts = Buffer.from(renderKnownHosts(profiles), 'utf8');
      const desiredManagedConfig = Buffer.from(
        renderManagedConfig(profiles, paths.knownHosts),
        'utf8',
      );
      const snapshot = await this.inspectManagedSnapshot(
        paths,
        desiredKnownHosts,
        desiredManagedConfig,
      );
      if (snapshot.existingManagedConfig === undefined && desiredManagedConfig.length !== 0) {
        throw new DomainError('LOCAL_CONFIG_CONFLICT', 'managed-config-external-change');
      }
      const managedConfig = snapshot.existingManagedConfig ?? Buffer.alloc(0);
      rollback = {
        knownHosts: { before: snapshot.existingKnownHosts, after: desiredKnownHosts },
        managedConfig: { before: snapshot.existingManagedConfig, after: managedConfig },
      };
      await this.atomicWrite(
        paths.managedConfig,
        managedConfig,
        snapshot.existingManagedConfig,
        true,
      );
      await this.atomicWrite(
        paths.knownHosts,
        desiredKnownHosts,
        snapshot.existingKnownHosts,
        true,
      );
      await this.writeStateLast(paths, managedConfig, desiredKnownHosts, snapshot.stateSource);
    } catch (error: unknown) {
      if (rollback !== undefined) {
        await this.rollbackCommit(paths, rollback);
      }
      throw normalizeConfigError(error);
    } finally {
      await this.releaseManagedLock(lock);
    }
  }

  public async synchronize(source: ProfileSource, paths: SshConfigPaths): Promise<void> {
    await mkdir(path.dirname(paths.userConfig), { recursive: true });
    await this.acl.ensureRestrictedDirectory(paths.managedDirectory);
    await this.assertRegularOrMissing(paths.userConfig);
    await this.assertRegularOrMissing(paths.managedConfig);
    await this.assertRegularOrMissing(paths.knownHosts);
    await this.assertRegularOrMissing(paths.managedState);
    const lock = await this.acquireManagedLock(paths);
    let rollback: CommitRollback | undefined;
    try {
      await this.assertManagedFilesSafe(paths);
      const profiles = readProfiles(source);
      const userExisting = await readOptional(paths.userConfig);
      const userSource = userExisting ?? Buffer.alloc(0);
      assertNoAliasConflict(userSource, managedAliases(profiles));
      const sourceHash = digestOrMissing(userExisting);
      const include = ensureManagedInclude(userSource, paths.managedConfig);
      const desiredKnownHosts = Buffer.from(renderKnownHosts(profiles), 'utf8');
      const desiredManagedConfig = Buffer.from(
        renderManagedConfig(profiles, paths.knownHosts),
        'utf8',
      );
      const snapshot = await this.inspectManagedSnapshot(
        paths,
        desiredKnownHosts,
        desiredManagedConfig,
      );
      rollback = {
        knownHosts: { before: snapshot.existingKnownHosts, after: desiredKnownHosts },
        managedConfig: {
          before: snapshot.existingManagedConfig,
          after: desiredManagedConfig,
        },
        ...(include.changed
          ? { userConfig: { before: userExisting, after: include.content } }
          : {}),
      };

      await this.atomicWrite(
        paths.knownHosts,
        desiredKnownHosts,
        snapshot.existingKnownHosts,
        true,
      );
      await this.atomicWrite(
        paths.managedConfig,
        desiredManagedConfig,
        snapshot.existingManagedConfig,
        true,
      );
      if (include.changed) {
        const current = await readOptional(paths.userConfig);
        if (digestOrMissing(current) !== sourceHash) {
          throw new DomainError('LOCAL_CONFIG_CONFLICT', 'concurrent-change');
        }
        if (userExisting !== undefined && userSource.length > 0) {
          await writeFile(`${paths.userConfig}.backup.${timestamp()}`, userSource, {
            flag: 'wx',
            mode: 0o600,
          });
        }
        await this.atomicWrite(paths.userConfig, include.content, userExisting);
      }
      await this.writeStateLast(
        paths,
        desiredManagedConfig,
        desiredKnownHosts,
        snapshot.stateSource,
      );
    } catch (error: unknown) {
      if (rollback !== undefined) {
        await this.rollbackCommit(paths, rollback);
      }
      throw normalizeConfigError(error);
    } finally {
      await this.releaseManagedLock(lock);
    }
  }

  private async inspectManagedSnapshot(
    paths: SshConfigPaths,
    desiredKnownHosts: Buffer,
    desiredManagedConfig: Buffer,
  ): Promise<ManagedSnapshot> {
    const existingKnownHosts = await readOptional(paths.knownHosts);
    const existingManagedConfig = await readOptional(paths.managedConfig);
    const stateSource = await readOptional(paths.managedState);
    const state = parseManagedState(stateSource);

    if (state !== undefined) {
      if (state.authorityHash !== undefined && state.authorityHash !== this.authorityHash) {
        throw new DomainError('LOCAL_CONFIG_CONFLICT', 'managed-state-owner');
      }
      if (
        state.authorityHash === undefined &&
        (existingKnownHosts?.equals(desiredKnownHosts) !== true ||
          existingManagedConfig?.equals(desiredManagedConfig) !== true)
      ) {
        throw new DomainError('LOCAL_CONFIG_CONFLICT', 'managed-state-owner');
      }
      this.assertManagedBaseline(
        existingKnownHosts,
        desiredKnownHosts,
        state.knownHostsHash,
        'known-hosts-external-change',
      );
      this.assertManagedBaseline(
        existingManagedConfig,
        desiredManagedConfig,
        state.managedConfigHash,
        'managed-config-external-change',
      );
      return {
        existingKnownHosts,
        existingManagedConfig,
        stateSource,
        state,
        recovery: 'none',
      };
    }

    if (existingKnownHosts === undefined && existingManagedConfig === undefined) {
      return {
        existingKnownHosts,
        existingManagedConfig,
        stateSource,
        state,
        recovery: 'none',
      };
    }

    const knownHostsMatch = existingKnownHosts?.equals(desiredKnownHosts) === true;
    const preview2Residue =
      existingKnownHosts !== undefined &&
      knownHostsMatch &&
      existingManagedConfig === undefined &&
      desiredKnownHosts.length !== 0 &&
      desiredManagedConfig.length === 0;
    if (preview2Residue) {
      return {
        existingKnownHosts,
        existingManagedConfig,
        stateSource,
        state,
        recovery: 'preview-2',
      };
    }
    throw new DomainError('LOCAL_CONFIG_CONFLICT', 'managed-state');
  }

  private async writeStateLast(
    paths: SshConfigPaths,
    managedConfig: Buffer,
    knownHosts: Buffer,
    expectedState: Buffer | undefined,
  ): Promise<void> {
    const nextState: ManagedFileStateV1 = {
      schemaVersion: 1,
      authorityHash: this.authorityHash,
      managedConfigHash: digest(managedConfig),
      knownHostsHash: digest(knownHosts),
    };
    await this.atomicWrite(
      paths.managedState,
      Buffer.from(`${JSON.stringify(nextState)}\n`, 'utf8'),
      expectedState,
      true,
    );
  }

  private async rollbackCommit(paths: SshConfigPaths, rollback: CommitRollback): Promise<void> {
    if (rollback.userConfig !== undefined) {
      await this.restoreOptionalFile(
        paths.userConfig,
        rollback.userConfig.before,
        rollback.userConfig.after,
        false,
      );
    }
    await this.restoreOptionalFile(
      paths.managedConfig,
      rollback.managedConfig.before,
      rollback.managedConfig.after,
      true,
    );
    await this.restoreOptionalFile(
      paths.knownHosts,
      rollback.knownHosts.before,
      rollback.knownHosts.after,
      true,
    );
  }

  private async restoreOptionalFile(
    filePath: string,
    before: Buffer | undefined,
    after: Buffer,
    protectManagedFile: boolean,
  ): Promise<void> {
    const current = await readOptional(filePath);
    if (sameOptionalBuffer(current, before)) {
      return;
    }
    if (current?.equals(after) !== true) {
      throw new DomainError('LOCAL_CONFIG_CONFLICT', 'concurrent-change');
    }
    if (before === undefined) {
      const latest = await readOptional(filePath);
      if (latest?.equals(after) !== true) {
        throw new DomainError('LOCAL_CONFIG_CONFLICT', 'concurrent-change');
      }
      await unlink(filePath);
      return;
    }
    await this.atomicWrite(filePath, before, current, protectManagedFile);
  }

  private async expandConfig(tools: OpenSshTools, paths: SshConfigPaths, alias: string) {
    const request = {
      executable: tools.ssh,
      args: ['-F', paths.userConfig, '-G', alias],
      timeoutMs: 10_000,
      errorCode: 'LOCAL_CONFIG_CONFLICT' as const,
    };
    let result = await this.runner.run(request);
    if (result.exitCode !== 0) {
      result = await this.runner.run(request);
      if (result.exitCode !== 0) {
        throw new DomainError('LOCAL_CONFIG_CONFLICT', `exit:${String(result.exitCode)}`);
      }
    }
    return result;
  }

  private async assertManagedDirectorySafeOrMissing(directory: string): Promise<void> {
    try {
      const stats = await lstat(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new DomainError('LOCAL_CONFIG_CONFLICT', 'unsafe-file');
      }
      try {
        await this.acl.assertDirectorySafe(directory);
      } catch {
        throw new DomainError('LOCAL_CONFIG_CONFLICT', 'unsafe-file');
      }
    } catch (error: unknown) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  }

  private async assertRegularOrMissing(filePath: string): Promise<void> {
    try {
      const stats = await lstat(filePath);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new DomainError('LOCAL_CONFIG_CONFLICT', 'unsafe-file');
      }
    } catch (error: unknown) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  }

  private async assertManagedFileOrMissing(filePath: string): Promise<void> {
    try {
      const stats = await lstat(filePath);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new DomainError('LOCAL_CONFIG_CONFLICT', 'unsafe-file');
      }
      try {
        await this.acl.assertManagedFileSafe(filePath);
      } catch {
        throw new DomainError('LOCAL_CONFIG_CONFLICT', 'unsafe-file');
      }
    } catch (error: unknown) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  }

  private async assertManagedFilesSafe(paths: SshConfigPaths): Promise<void> {
    await Promise.all([
      this.assertManagedFileOrMissing(paths.managedConfig),
      this.assertManagedFileOrMissing(paths.knownHosts),
      this.assertManagedFileOrMissing(paths.managedState),
    ]);
  }

  private async assertLockIsAbsent(paths: SshConfigPaths): Promise<void> {
    try {
      await lstat(path.join(paths.managedDirectory, '.lock'));
      throw new DomainError('LOCAL_CONFIG_CONFLICT', 'lock');
    } catch (error: unknown) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  }

  private assertManagedBaseline(
    existing: Buffer | undefined,
    desired: Buffer,
    recordedHash: string,
    detail: string,
  ): void {
    const matchesRecorded = digestOrMissing(existing) === recordedHash;
    if (!matchesRecorded && existing?.equals(desired) !== true) {
      throw new DomainError('LOCAL_CONFIG_CONFLICT', detail);
    }
  }

  private async acquireManagedLock(paths: SshConfigPaths): Promise<ManagedLock> {
    const lockPath = path.join(paths.managedDirectory, '.lock');
    let handle: FileHandle;
    try {
      handle = await open(lockPath, 'wx', 0o600);
    } catch {
      throw new DomainError('LOCAL_CONFIG_CONFLICT', 'lock');
    }
    const token = randomUUID();
    try {
      await handle.writeFile(`${JSON.stringify({ token, pid: process.pid })}\n`, 'utf8');
      return { handle, path: lockPath, token };
    } catch (error: unknown) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }

  private async releaseManagedLock(lock: ManagedLock): Promise<void> {
    await lock.handle.close().catch(() => undefined);
    const owner = await readManagedLockToken(lock.path);
    if (owner === lock.token) {
      await unlink(lock.path).catch(() => undefined);
    }
  }

  private async atomicWrite(
    filePath: string,
    content: Buffer,
    expected: Buffer | undefined,
    protectManagedFile = false,
  ): Promise<void> {
    const existing = await readOptional(filePath);
    if (existing?.equals(content) === true) {
      return;
    }
    if (!sameOptionalBuffer(existing, expected)) {
      throw new DomainError('LOCAL_CONFIG_CONFLICT', 'concurrent-change');
    }
    const temporary = `${filePath}.tmp.${randomUUID()}`;
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    try {
      if (protectManagedFile) {
        try {
          await this.acl.restrictPrivateKey(temporary, true);
        } catch {
          throw new DomainError('LOCAL_CONFIG_CONFLICT', 'unsafe-file');
        }
      }
      const latest = await readOptional(filePath);
      if (latest?.equals(content) === true) {
        await unlink(temporary).catch(() => undefined);
        return;
      }
      if (!sameOptionalBuffer(latest, expected)) {
        throw new DomainError('LOCAL_CONFIG_CONFLICT', 'concurrent-change');
      }
      await rename(temporary, filePath);
    } catch (error: unknown) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}

function managedAliases(
  profiles: readonly ServerProfile[],
  projectedHost?: ProjectedManagedHost,
): readonly string[] {
  const aliases = new Map<string, string>();
  for (const profile of profiles) {
    if (
      profile.localKey !== undefined &&
      profile.trustedHostKey !== undefined &&
      profile.authorization !== undefined
    ) {
      aliases.set(profile.id, profile.alias);
    }
  }
  if (projectedHost !== undefined) {
    aliases.set(projectedHost.id, projectedHost.alias);
  }
  return [...aliases.values()];
}

function readProfiles(source: ProfileSource): readonly ServerProfile[] {
  return typeof source === 'function' ? source() : source;
}

function expandHome(value: string): string {
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function digest(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function digestOrMissing(content: Buffer | undefined): string {
  return content === undefined ? 'missing' : digest(content);
}

function sameOptionalBuffer(left: Buffer | undefined, right: Buffer | undefined): boolean {
  return left === undefined ? right === undefined : right !== undefined && left.equals(right);
}

async function readOptional(filePath: string): Promise<Buffer | undefined> {
  return readFile(filePath).catch((error: unknown) => {
    if (isMissing(error)) {
      return undefined;
    }
    throw error;
  });
}

function parseManagedState(source: Buffer | undefined): ManagedFileStateV1 | undefined {
  if (source === undefined) {
    return undefined;
  }
  try {
    const value = JSON.parse(source.toString('utf8')) as Partial<ManagedFileStateV1>;
    if (
      value.schemaVersion !== 1 ||
      (value.authorityHash !== undefined &&
        (typeof value.authorityHash !== 'string' ||
          !/^[0-9a-f]{64}$/u.test(value.authorityHash))) ||
      typeof value.managedConfigHash !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(value.managedConfigHash) ||
      typeof value.knownHostsHash !== 'string' ||
      !/^[0-9a-f]{64}$/u.test(value.knownHostsHash)
    ) {
      throw new Error('invalid state');
    }
    return value as ManagedFileStateV1;
  } catch {
    throw new DomainError('LOCAL_CONFIG_CONFLICT', 'managed-state');
  }
}

async function readManagedLockToken(lockFile: string): Promise<string | undefined> {
  try {
    const value = JSON.parse(await readFile(lockFile, 'utf8')) as { readonly token?: unknown };
    return typeof value.token === 'string' ? value.token : undefined;
  } catch {
    return undefined;
  }
}

function normalizeConfigError(error: unknown): DomainError {
  return error instanceof DomainError ? error : new DomainError('LOCAL_CONFIG_CONFLICT');
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/gu, '-');
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}
