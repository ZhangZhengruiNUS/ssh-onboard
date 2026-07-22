import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { mkdir, open, rename, unlink, writeFile, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

import type * as vscode from 'vscode';

import { DomainError } from '../core/domainError';
import { omitProperties } from '../core/objects';
import {
  PROFILE_SCHEMA_VERSION,
  isServerProfile,
  normalizeProfileDraft,
  validateProfileDraft,
  type ProfileDraft,
  type ServerProfile,
} from '../domain/profiles';

const STORAGE_KEY = 'sshOnboard.profiles';
const MAX_STORAGE_BYTES = 8 * 1024 * 1024;

interface ProfileEnvelopeV1 {
  readonly schemaVersion: 1;
  readonly profiles: readonly ServerProfile[];
}

interface MutationResult<T> {
  readonly profiles: readonly ServerProfile[];
  readonly result: T;
}

interface OwnedStorageLock {
  readonly handle: FileHandle;
  readonly path: string;
  readonly token: string;
}

export class ProfileStore {
  private mutationTail: Promise<void> = Promise.resolve();
  private readonly profilesFile?: string;
  private readonly lockFile?: string;

  public constructor(
    private readonly state: vscode.Memento,
    storageDirectory?: string,
  ) {
    if (storageDirectory !== undefined) {
      this.profilesFile = path.join(storageDirectory, 'profiles.json');
      this.lockFile = path.join(storageDirectory, 'profiles.lock');
    }
  }

  public list(): readonly ServerProfile[] {
    const value = this.readEnvelope();
    if (value === undefined) {
      return [];
    }
    if (!isEnvelopeV1(value)) {
      throw new DomainError('INVALID_PROFILE');
    }
    return [...value.profiles].sort((left, right) => left.name.localeCompare(right.name));
  }

  public get configurationAuthority(): string {
    const source = this.profilesFile ?? 'ssh-onboard:in-memory-profile-store';
    return createHash('sha256').update(path.resolve(source).toLowerCase()).digest('hex');
  }

  public get(profileId: string): ServerProfile {
    const profile = this.list().find((candidate) => candidate.id === profileId);
    if (profile === undefined) {
      throw new DomainError('PROFILE_NOT_FOUND');
    }
    return profile;
  }

  public async add(draft: ProfileDraft): Promise<ServerProfile> {
    const normalized = normalizeProfileDraft(draft);
    this.assertValid(normalized);
    return this.mutate((profiles) => {
      this.assertAliasAvailable(normalized.alias, profiles);
      const profile: ServerProfile = {
        schemaVersion: PROFILE_SCHEMA_VERSION,
        id: randomUUID(),
        ...normalized,
        platform: 'linux',
      };
      return { profiles: [...profiles, profile], result: profile };
    });
  }

  public async update(profile: ServerProfile): Promise<void> {
    await this.mutate((profiles) => {
      const index = profiles.findIndex((candidate) => candidate.id === profile.id);
      if (index < 0) {
        throw new DomainError('PROFILE_NOT_FOUND');
      }
      this.assertAliasAvailable(profile.alias, profiles, profile.id);
      const next = [...profiles];
      next[index] = profile;
      return { profiles: next, result: undefined };
    });
  }

  public async updateDraft(profileId: string, draft: ProfileDraft): Promise<ServerProfile> {
    const normalized = normalizeProfileDraft(draft);
    this.assertValid(normalized);
    return this.mutate((profiles) => {
      const result = this.buildUpdatedProfile(profileId, normalized, profiles);
      return {
        profiles: profiles.map((candidate) => (candidate.id === result.id ? result : candidate)),
        result,
      };
    });
  }

  public projectUpdateDraft(profileId: string, draft: ProfileDraft): ServerProfile {
    const normalized = normalizeProfileDraft(draft);
    this.assertValid(normalized);
    return this.buildUpdatedProfile(profileId, normalized, this.list());
  }

  public async remove(profileId: string): Promise<void> {
    await this.mutate((profiles) => {
      const target = profiles.find((candidate) => candidate.id === profileId);
      if (
        target?.authorization?.ownership === 'managed' ||
        target?.pendingAuthorization !== undefined
      ) {
        throw new DomainError('LOCAL_CONFIG_CONFLICT', 'revoke-before-remove');
      }
      const next = profiles.filter((candidate) => candidate.id !== profileId);
      if (next.length === profiles.length) {
        throw new DomainError('PROFILE_NOT_FOUND');
      }
      return { profiles: next, result: undefined };
    });
  }

  public async withProfileOperation<T>(
    profileId: string,
    operation: (profile: ServerProfile) => T | Promise<T>,
  ): Promise<T> {
    if (this.profilesFile === undefined) {
      return operation(this.get(profileId));
    }
    const operationLock = path.join(
      path.dirname(this.profilesFile),
      `profile.${profileId}.operation.lock`,
    );
    await mkdir(path.dirname(operationLock), { recursive: true });
    let handle: FileHandle;
    try {
      handle = await open(operationLock, 'wx', 0o600);
    } catch (error: unknown) {
      if (isAlreadyExists(error)) {
        throw new DomainError('LOCAL_CONFIG_CONFLICT', 'profile-operation-in-progress');
      }
      throw new DomainError('LOCAL_CONFIG_CONFLICT', 'profile-operation-lock');
    }
    const token = randomUUID();
    let tokenWritten = false;
    try {
      await handle.writeFile(`${JSON.stringify({ token, pid: process.pid })}\n`, 'utf8');
      tokenWritten = true;
      return await operation(this.get(profileId));
    } finally {
      await handle.close();
      const owner = readLockToken(operationLock);
      if (tokenWritten && owner === token) {
        await unlink(operationLock).catch(() => undefined);
      }
    }
  }

  public async withConfigurationOperation<T>(operation: () => T | Promise<T>): Promise<T> {
    if (this.profilesFile === undefined) {
      return operation();
    }
    const operationLock = path.join(
      path.dirname(this.profilesFile),
      'configuration.operation.lock',
    );
    await mkdir(path.dirname(operationLock), { recursive: true });
    let handle: FileHandle | undefined;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        handle = await open(operationLock, 'wx', 0o600);
        break;
      } catch (error: unknown) {
        if (!isAlreadyExists(error)) {
          throw new DomainError('LOCAL_CONFIG_CONFLICT', 'configuration-operation-lock');
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    if (handle === undefined) {
      throw new DomainError('LOCAL_CONFIG_CONFLICT', 'configuration-operation-in-progress');
    }
    const token = randomUUID();
    let tokenWritten = false;
    try {
      await handle.writeFile(`${JSON.stringify({ token, pid: process.pid })}\n`, 'utf8');
      tokenWritten = true;
      return await operation();
    } finally {
      await handle.close();
      const owner = readLockToken(operationLock);
      if (tokenWritten && owner === token) {
        await unlink(operationLock).catch(() => undefined);
      }
    }
  }

  private assertValid(draft: ProfileDraft): void {
    const errors = validateProfileDraft(draft);
    if (errors.length > 0) {
      throw new DomainError('INVALID_PROFILE', errors.join(','));
    }
  }

  private buildUpdatedProfile(
    profileId: string,
    normalized: ProfileDraft,
    profiles: readonly ServerProfile[],
  ): ServerProfile {
    const current = profiles.find((candidate) => candidate.id === profileId);
    if (current === undefined) {
      throw new DomainError('PROFILE_NOT_FOUND');
    }
    const endpointChanged =
      current.host !== normalized.host ||
      current.port !== normalized.port ||
      current.username !== normalized.username;
    const keyStrategyChanged =
      JSON.stringify(current.keyStrategy) !== JSON.stringify(normalized.keyStrategy);
    if (
      (endpointChanged || keyStrategyChanged) &&
      (current.authorization?.ownership === 'managed' || current.pendingAuthorization !== undefined)
    ) {
      throw new DomainError('LOCAL_CONFIG_CONFLICT', 'revoke-before-edit');
    }
    const connectionSettingsChanged =
      endpointChanged ||
      keyStrategyChanged ||
      current.alias !== normalized.alias ||
      current.defaultPath !== normalized.defaultPath;
    let next: ServerProfile = { ...current, ...normalized };
    if (endpointChanged) {
      next = omitConnectionState(next, true);
    } else if (keyStrategyChanged) {
      next = omitConnectionState(next, false);
    } else if (connectionSettingsChanged) {
      next = omitProperties(next, ['lastVerifiedAt', 'verificationContext', 'lastErrorCode']);
    }
    const result = stripUndefined(next);
    this.assertAliasAvailable(result.alias, profiles, result.id);
    return result;
  }

  private assertAliasAvailable(
    alias: string,
    profiles: readonly ServerProfile[],
    currentProfileId?: string,
  ): void {
    const conflict = profiles.some(
      (profile) =>
        profile.id !== currentProfileId && profile.alias.toLowerCase() === alias.toLowerCase(),
    );
    if (conflict) {
      throw new DomainError('LOCAL_CONFIG_CONFLICT', 'alias');
    }
  }

  private readEnvelope(): unknown {
    if (this.profilesFile !== undefined && existsSync(this.profilesFile)) {
      const stats = lstatSync(this.profilesFile);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_STORAGE_BYTES) {
        throw new DomainError('INVALID_PROFILE', 'unsafe-storage-file');
      }
      try {
        return JSON.parse(readFileSync(this.profilesFile, 'utf8')) as unknown;
      } catch {
        throw new DomainError('INVALID_PROFILE', 'storage-json');
      }
    }
    return this.state.get<unknown>(STORAGE_KEY);
  }

  private async persist(profiles: readonly ServerProfile[]): Promise<void> {
    const envelope: ProfileEnvelopeV1 = {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      profiles,
    };
    if (this.profilesFile !== undefined) {
      const temporary = `${this.profilesFile}.tmp.${randomUUID()}`;
      await writeFile(temporary, `${JSON.stringify(envelope)}\n`, { flag: 'wx', mode: 0o600 });
      try {
        await rename(temporary, this.profilesFile);
      } catch (error: unknown) {
        await unlink(temporary).catch(() => undefined);
        throw error;
      }
    }
    await this.state.update(STORAGE_KEY, envelope);
  }

  private mutate<T>(
    operation: (
      profiles: readonly ServerProfile[],
    ) => MutationResult<T> | Promise<MutationResult<T>>,
  ): Promise<T> {
    const run = this.mutationTail.then(async () => {
      const lock = await this.acquireStorageLock();
      try {
        const next = await operation(this.list());
        await this.persist(next.profiles);
        return next.result;
      } finally {
        await this.releaseStorageLock(lock);
      }
    });
    this.mutationTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async acquireStorageLock(): Promise<OwnedStorageLock | undefined> {
    if (this.lockFile === undefined) {
      return undefined;
    }
    await mkdir(path.dirname(this.lockFile), { recursive: true });
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const handle = await open(this.lockFile, 'wx', 0o600);
        const token = randomUUID();
        try {
          await handle.writeFile(`${JSON.stringify({ token, pid: process.pid })}\n`, 'utf8');
          return { handle, path: this.lockFile, token };
        } catch (error: unknown) {
          await handle.close().catch(() => undefined);
          throw error;
        }
      } catch (error: unknown) {
        if (!isAlreadyExists(error)) {
          throw new DomainError('LOCAL_CONFIG_CONFLICT', 'profile-lock');
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    throw new DomainError('LOCAL_CONFIG_CONFLICT', 'profile-lock-timeout');
  }

  private async releaseStorageLock(lock: OwnedStorageLock | undefined): Promise<void> {
    if (lock === undefined) {
      return;
    }
    await lock.handle.close();
    const owner = readLockToken(lock.path);
    if (owner === lock.token) {
      await unlink(lock.path).catch(() => undefined);
    }
  }
}

function omitConnectionState(profile: ServerProfile, clearTrust: boolean): ServerProfile {
  const base = omitProperties(profile, [
    'authorization',
    'pendingAuthorization',
    'lastErrorCode',
    'lastVerifiedAt',
    'verificationContext',
    'localKey',
    'trustedHostKey',
  ]);
  return clearTrust
    ? base
    : {
        ...base,
        ...(profile.trustedHostKey === undefined ? {} : { trustedHostKey: profile.trustedHostKey }),
      };
}

function isEnvelopeV1(value: unknown): value is ProfileEnvelopeV1 {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const envelope = value as Partial<ProfileEnvelopeV1>;
  if (!(
    envelope.schemaVersion === PROFILE_SCHEMA_VERSION &&
    Array.isArray(envelope.profiles) &&
    envelope.profiles.every((profile) => isServerProfile(profile))
  )) {
    return false;
  }
  const ids = new Set(envelope.profiles.map((profile) => profile.id));
  const aliases = new Set(envelope.profiles.map((profile) => profile.alias.toLowerCase()));
  return ids.size === envelope.profiles.length && aliases.size === envelope.profiles.length;
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'EEXIST'
  );
}

function readLockToken(lockFile: string): string | undefined {
  try {
    const value = JSON.parse(readFileSync(lockFile, 'utf8')) as { readonly token?: unknown };
    return typeof value.token === 'string' ? value.token : undefined;
  } catch {
    return undefined;
  }
}
