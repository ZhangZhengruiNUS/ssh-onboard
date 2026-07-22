import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

import type { SFTPWrapper, Stats } from 'ssh2';

import { DomainError } from '../core/domainError';
import { appendAuthorizedKey, revokeAuthorizedKey } from '../domain/authorizedKeys';
import { parsePublicKeyLine } from '../domain/keys';
import type { AuthorizationRecord, LocalKeyReference, ServerProfile } from '../domain/profiles';
import type { RemoteLayout } from './remoteLayoutService';
import {
  sftpChmod,
  sftpMkdir,
  sftpReadFile,
  sftpAtomicReplace,
  sftpRmdir,
  sftpTryLstat,
  sftpUnlink,
  sftpWriteFile,
  sftpWriteFileDurable,
} from './ssh2Utils';

const FILE_TYPE_MASK = 0o170000;
const DIRECTORY_TYPE = 0o040000;
const REGULAR_FILE_TYPE = 0o100000;
const SYMBOLIC_LINK_TYPE = 0o120000;
const MAX_AUTHORIZED_KEYS_BYTES = 16 * 1024 * 1024;

export class AuthorizedKeysService {
  public async deploy(
    sftp: SFTPWrapper,
    key: LocalKeyReference,
    layout: RemoteLayout,
    plan: Extract<AuthorizationRecord, { readonly ownership: 'managed' }>,
  ): Promise<AuthorizationRecord> {
    const sshDirectory = path.posix.join(layout.home, '.ssh');
    const target = path.posix.join(sshDirectory, 'authorized_keys');
    const lock = path.posix.join(sshDirectory, '.ssh-onboard.lock');
    const temporary = path.posix.join(
      sshDirectory,
      `.authorized_keys.ssh-onboard.${randomUUID()}.tmp`,
    );
    await this.ensureSshDirectory(sftp, sshDirectory, layout.uid);
    const lockToken = await this.acquireLock(sftp, lock);
    let temporaryCreated = false;
    try {
      const originalStats = await sftpTryLstat(sftp, target);
      this.assertSafeFile(originalStats, layout);
      const source =
        originalStats === undefined ? Buffer.alloc(0) : await sftpReadFile(sftp, target);
      const sourceHash = digest(source);
      if (plan.fingerprint !== key.fingerprint) {
        throw new DomainError('AUTHORIZED_KEYS_WRITE_FAILED', 'plan-key-mismatch');
      }
      const appended = appendAuthorizedKey(source, plan);
      if (appended.alreadyPresent) {
        return {
          ownership: 'external',
          fingerprint: key.fingerprint,
          detectedAt: new Date().toISOString(),
        };
      }

      const targetMode = originalStats === undefined ? 0o600 : originalStats.mode & 0o777;
      if (appended.content.equals(source)) {
        return plan;
      }
      if (appended.content.length > MAX_AUTHORIZED_KEYS_BYTES) {
        throw new DomainError('REMOTE_LAYOUT_UNSAFE', 'authorized-keys-size');
      }
      await sftpWriteFileDurable(sftp, temporary, appended.content, targetMode).catch(() => {
        throw new DomainError('AUTHORIZED_KEYS_WRITE_FAILED');
      });
      temporaryCreated = true;
      await sftpChmod(sftp, temporary, targetMode);
      await this.assertUnchanged(sftp, target, originalStats, sourceHash);
      await sftpAtomicReplace(sftp, temporary, target);
      temporaryCreated = false;
      await this.assertInstalled(sftp, target, appended.content, layout, targetMode);

      if (appended.deploymentMarker === undefined || appended.deployedPublicKeyLine === undefined) {
        throw new DomainError('AUTHORIZED_KEYS_WRITE_FAILED');
      }
      return {
        ownership: 'managed',
        fingerprint: key.fingerprint,
        deploymentMarker: appended.deploymentMarker,
        deployedPublicKeyLine: appended.deployedPublicKeyLine,
        deployedAt: new Date().toISOString(),
      };
    } finally {
      if (temporaryCreated) {
        await sftpUnlink(sftp, temporary).catch(() => undefined);
      }
      await this.releaseLock(sftp, lock, lockToken);
    }
  }

  public async revoke(
    sftp: SFTPWrapper,
    profile: ServerProfile,
    layout: RemoteLayout,
  ): Promise<boolean> {
    const authorization = profile.authorization;
    if (authorization?.ownership !== 'managed') {
      throw new DomainError('AUTHORIZED_KEYS_WRITE_FAILED', 'not-managed');
    }
    const sshDirectory = path.posix.join(layout.home, '.ssh');
    const target = path.posix.join(sshDirectory, 'authorized_keys');
    const lock = path.posix.join(sshDirectory, '.ssh-onboard.lock');
    const temporary = path.posix.join(
      sshDirectory,
      `.authorized_keys.ssh-onboard.${randomUUID()}.tmp`,
    );
    await this.ensureSshDirectory(sftp, sshDirectory, layout.uid);
    const lockToken = await this.acquireLock(sftp, lock);
    let temporaryCreated = false;
    try {
      const originalStats = await sftpTryLstat(sftp, target);
      this.assertSafeFile(originalStats, layout);
      if (originalStats === undefined) {
        return true;
      }
      const source = await sftpReadFile(sftp, target);
      const result = revokeAuthorizedKey(
        source,
        authorization.deployedPublicKeyLine,
        authorization.deploymentMarker,
        authorization.fingerprint,
      );
      if (!result.removed) {
        return true;
      }
      const targetMode = originalStats.mode & 0o777;
      await sftpWriteFileDurable(sftp, temporary, result.content, targetMode).catch(() => {
        throw new DomainError('AUTHORIZED_KEYS_WRITE_FAILED');
      });
      temporaryCreated = true;
      await this.assertUnchanged(sftp, target, originalStats, digest(source));
      await sftpAtomicReplace(sftp, temporary, target);
      temporaryCreated = false;
      await this.assertInstalled(sftp, target, result.content, layout, targetMode);
      return true;
    } catch (error: unknown) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw new DomainError('AUTHORIZED_KEYS_WRITE_FAILED');
    } finally {
      if (temporaryCreated) {
        await sftpUnlink(sftp, temporary).catch(() => undefined);
      }
      await this.releaseLock(sftp, lock, lockToken);
    }
  }

  private async ensureSshDirectory(
    sftp: SFTPWrapper,
    sshDirectory: string,
    uid: number,
  ): Promise<void> {
    let stats = await sftpTryLstat(sftp, sshDirectory);
    if (stats === undefined) {
      await sftpMkdir(sftp, sshDirectory, 0o700);
      stats = await sftpTryLstat(sftp, sshDirectory);
    }
    assertSafeSshDirectory(stats, uid);
  }

  private async acquireLock(sftp: SFTPWrapper, lock: string): Promise<string> {
    const token = randomUUID();
    const ownerFile = path.posix.join(lock, 'owner');
    let lockCreated = false;
    try {
      await sftpMkdir(sftp, lock, 0o700);
      lockCreated = true;
      await sftpWriteFile(sftp, ownerFile, Buffer.from(token, 'utf8'), 0o600);
      return token;
    } catch {
      if (lockCreated) {
        await sftpUnlink(sftp, ownerFile).catch(() => undefined);
        await sftpRmdir(sftp, lock).catch(() => undefined);
      }
      throw new DomainError('AUTHORIZED_KEYS_LOCKED');
    }
  }

  private async releaseLock(sftp: SFTPWrapper, lock: string, token: string): Promise<void> {
    const ownerFile = path.posix.join(lock, 'owner');
    try {
      const stats = await sftpTryLstat(sftp, ownerFile);
      if (stats === undefined || stats.size > 128) {
        return;
      }
      const actual = await sftpReadFile(sftp, ownerFile);
      if (actual.toString('utf8') !== token) {
        return;
      }
      await sftpUnlink(sftp, ownerFile);
      await sftpRmdir(sftp, lock);
    } catch {
      // A stale lock is safer than deleting a lock that we cannot prove we own.
    }
  }

  private assertSafeFile(stats: Stats | undefined, layout: RemoteLayout): void {
    assertSafeAuthorizedKeysFile(stats, layout.uid);
  }

  private async assertInstalled(
    sftp: SFTPWrapper,
    target: string,
    expected: Buffer,
    layout: RemoteLayout,
    expectedMode: number,
  ): Promise<void> {
    const stats = await sftpTryLstat(sftp, target);
    this.assertSafeFile(stats, layout);
    if (stats === undefined || (stats.mode & 0o777) !== expectedMode) {
      throw new DomainError('AUTHORIZED_KEYS_WRITE_FAILED', 'post-write-metadata');
    }
    const actual = await sftpReadFile(sftp, target);
    if (!actual.equals(expected)) {
      throw new DomainError('AUTHORIZED_KEYS_WRITE_FAILED', 'post-write-content');
    }
  }

  private async assertUnchanged(
    sftp: SFTPWrapper,
    target: string,
    originalStats: Stats | undefined,
    originalHash: string,
  ): Promise<void> {
    const currentStats = await sftpTryLstat(sftp, target);
    if (originalStats === undefined) {
      if (currentStats !== undefined) {
        throw new DomainError('AUTHORIZED_KEYS_WRITE_FAILED', 'concurrent-change');
      }
      return;
    }
    if (
      currentStats === undefined ||
      currentStats.size !== originalStats.size ||
      currentStats.mtime !== originalStats.mtime
    ) {
      throw new DomainError('AUTHORIZED_KEYS_WRITE_FAILED', 'concurrent-change');
    }
    const current = await sftpReadFile(sftp, target);
    if (digest(current) !== originalHash) {
      throw new DomainError('AUTHORIZED_KEYS_WRITE_FAILED', 'concurrent-change');
    }
  }
}

export function assertSafeSshDirectory(
  stats: Stats | undefined,
  uid: number,
): asserts stats is Stats {
  if (stats === undefined) {
    throw new DomainError('REMOTE_LAYOUT_UNSAFE', 'ssh-directory-missing');
  }
  if ((stats.mode & FILE_TYPE_MASK) !== DIRECTORY_TYPE) {
    throw new DomainError('REMOTE_LAYOUT_UNSAFE', 'ssh-directory-type');
  }
  if (stats.uid !== uid) {
    throw new DomainError('REMOTE_LAYOUT_UNSAFE', 'ssh-directory-owner');
  }
  const permissions = stats.mode & 0o777;
  if ((permissions & 0o022) !== 0 || (permissions & 0o700) !== 0o700) {
    throw new DomainError('REMOTE_LAYOUT_UNSAFE', 'ssh-directory-permissions');
  }
}

export function assertSafeAuthorizedKeysFile(stats: Stats | undefined, uid: number): void {
  if (stats === undefined) {
    return;
  }
  const type = stats.mode & FILE_TYPE_MASK;
  const permissions = stats.mode & 0o777;
  if (type === SYMBOLIC_LINK_TYPE || type !== REGULAR_FILE_TYPE) {
    throw new DomainError('REMOTE_LAYOUT_UNSAFE', 'authorized-keys-type');
  }
  if (stats.uid !== uid) {
    throw new DomainError('REMOTE_LAYOUT_UNSAFE', 'authorized-keys-owner');
  }
  if (stats.size > MAX_AUTHORIZED_KEYS_BYTES) {
    throw new DomainError('REMOTE_LAYOUT_UNSAFE', 'authorized-keys-size');
  }
  if ((permissions & 0o022) !== 0 || (permissions & 0o600) !== 0o600) {
    throw new DomainError('REMOTE_LAYOUT_UNSAFE', 'authorized-keys-permissions');
  }
}

function digest(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export function authorizedKeyFingerprint(line: string): string {
  return parsePublicKeyLine(line).fingerprint;
}
