import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
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

interface ManagedFileStateV1 {
  readonly schemaVersion: 1;
  readonly managedConfigHash: string;
  readonly knownHostsHash: string;
}

export class SshConfigService {
  public constructor(
    private readonly runner: ProcessRunner,
    private readonly acl: WindowsFileAcl,
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

  public async apply(
    profiles: readonly ServerProfile[],
    target: ServerProfile & Required<Pick<ServerProfile, 'localKey'>>,
    tools: OpenSshTools,
    paths: SshConfigPaths,
  ): Promise<void> {
    await this.synchronize(profiles, paths);
    const expanded = await this.expandConfig(tools, paths, target.alias);
    assertExpandedConfig(expanded.stdout, target, paths.knownHosts);
  }

  /**
   * Persist only the confirmed host keys before password authentication.
   * This intentionally does not create the managed Host block or modify the
   * user's SSH config; those changes happen only after remote key deployment.
   */
  public async persistKnownHosts(
    profiles: readonly ServerProfile[],
    paths: SshConfigPaths,
  ): Promise<void> {
    await this.acl.ensureRestrictedDirectory(paths.managedDirectory);
    await this.assertRegularOrMissing(paths.knownHosts);
    await this.assertRegularOrMissing(paths.managedState);
    const lockPath = path.join(paths.managedDirectory, '.lock');
    const lock = await open(lockPath, 'wx').catch(() => {
      throw new DomainError('LOCAL_CONFIG_CONFLICT', 'lock');
    });
    try {
      const desiredKnownHosts = Buffer.from(renderKnownHosts(profiles), 'utf8');
      const existingKnownHosts = await readOptional(paths.knownHosts);
      const stateSource = await readOptional(paths.managedState);
      const state = parseManagedState(stateSource);
      this.assertManagedBaseline(
        existingKnownHosts,
        desiredKnownHosts,
        state?.knownHostsHash,
        'known-hosts-external-change',
      );
      await this.atomicWrite(paths.knownHosts, desiredKnownHosts, existingKnownHosts);
      if (state !== undefined) {
        const nextState: ManagedFileStateV1 = {
          ...state,
          knownHostsHash: digest(desiredKnownHosts),
        };
        await this.atomicWrite(
          paths.managedState,
          Buffer.from(`${JSON.stringify(nextState)}\n`, 'utf8'),
          stateSource,
        );
      }
    } catch (error: unknown) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError('LOCAL_CONFIG_CONFLICT');
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }

  public async synchronize(
    profiles: readonly ServerProfile[],
    paths: SshConfigPaths,
  ): Promise<void> {
    await mkdir(path.dirname(paths.userConfig), { recursive: true });
    await this.acl.ensureRestrictedDirectory(paths.managedDirectory);
    await this.assertRegularOrMissing(paths.userConfig);
    await this.assertRegularOrMissing(paths.managedConfig);
    await this.assertRegularOrMissing(paths.knownHosts);
    await this.assertRegularOrMissing(paths.managedState);
    const lockPath = path.join(paths.managedDirectory, '.lock');
    const lock = await open(lockPath, 'wx').catch(() => {
      throw new DomainError('LOCAL_CONFIG_CONFLICT', 'lock');
    });
    try {
      const userExisting = await readOptional(paths.userConfig);
      const userSource = userExisting ?? Buffer.alloc(0);
      assertNoAliasConflict(
        userSource,
        profiles.map((profile) => profile.alias),
      );
      const sourceHash = digestOrMissing(userExisting);
      const include = ensureManagedInclude(userSource, paths.managedConfig);
      const desiredKnownHosts = Buffer.from(renderKnownHosts(profiles), 'utf8');
      const desiredManagedConfig = Buffer.from(
        renderManagedConfig(profiles, paths.knownHosts),
        'utf8',
      );
      const existingKnownHosts = await readOptional(paths.knownHosts);
      const existingManagedConfig = await readOptional(paths.managedConfig);
      const stateSource = await readOptional(paths.managedState);
      const state = parseManagedState(stateSource);
      this.assertManagedBaseline(
        existingKnownHosts,
        desiredKnownHosts,
        state?.knownHostsHash,
        'known-hosts-external-change',
      );
      this.assertManagedBaseline(
        existingManagedConfig,
        desiredManagedConfig,
        state?.managedConfigHash,
        'managed-config-external-change',
      );
      await this.atomicWrite(paths.knownHosts, desiredKnownHosts, existingKnownHosts);
      await this.atomicWrite(paths.managedConfig, desiredManagedConfig, existingManagedConfig);
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
      const nextState: ManagedFileStateV1 = {
        schemaVersion: 1,
        managedConfigHash: digest(desiredManagedConfig),
        knownHostsHash: digest(desiredKnownHosts),
      };
      await this.atomicWrite(
        paths.managedState,
        Buffer.from(`${JSON.stringify(nextState)}\n`, 'utf8'),
        stateSource,
      );
    } catch (error: unknown) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError('LOCAL_CONFIG_CONFLICT');
    } finally {
      await lock.close();
      await unlink(lockPath).catch(() => undefined);
    }
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
      // Windows OpenSSH can briefly observe the previous file handle immediately
      // after an atomic rename. Retry once, but still fail closed on the second result.
      result = await this.runner.run(request);
      if (result.exitCode !== 0) {
        throw new DomainError('LOCAL_CONFIG_CONFLICT', `exit:${String(result.exitCode)}`);
      }
    }
    return result;
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

  private assertManagedBaseline(
    existing: Buffer | undefined,
    desired: Buffer,
    recordedHash: string | undefined,
    detail: string,
  ): void {
    const matchesRecorded =
      recordedHash === undefined
        ? existing === undefined
        : digestOrMissing(existing) === recordedHash;
    if (!matchesRecorded && existing?.equals(desired) !== true) {
      throw new DomainError('LOCAL_CONFIG_CONFLICT', detail);
    }
  }

  private async atomicWrite(
    filePath: string,
    content: Buffer,
    expected: Buffer | undefined,
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
