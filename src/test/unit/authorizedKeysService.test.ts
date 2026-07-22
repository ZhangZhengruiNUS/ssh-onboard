import * as assert from 'node:assert/strict';

import type { SFTPWrapper, Stats } from 'ssh2';

import { DomainError } from '../../core/domainError';
import { createDeploymentPlan } from '../../domain/authorizedKeys';
import { parsePublicKeyLine } from '../../domain/keys';
import {
  assertSafeAuthorizedKeysFile,
  assertSafeSshDirectory,
  AuthorizedKeysService,
} from '../../services/authorizedKeysService';

const publicKey =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA test';

suite('AuthorizedKeysService locking', () => {
  test("does not delete another operation's lock when acquisition fails", async () => {
    let unlinkCalls = 0;
    let rmdirCalls = 0;
    const directoryStats = createStats(0o040700);
    const sftp = {
      lstat(_remotePath: string, callback: (error: Error | undefined, stats?: Stats) => void) {
        callback(undefined, directoryStats);
      },
      mkdir(
        _remotePath: string,
        _attributes: { readonly mode: number },
        callback: (error?: Error) => void,
      ) {
        callback(new Error('already exists'));
      },
      unlink(_remotePath: string, callback: (error?: Error) => void) {
        unlinkCalls += 1;
        callback();
      },
      rmdir(_remotePath: string, callback: (error?: Error) => void) {
        rmdirCalls += 1;
        callback();
      },
    } as unknown as SFTPWrapper;
    const parsed = parsePublicKeyLine(publicKey);
    const key = {
      keyId: 'test',
      privateKeyPath: 'unused',
      fingerprint: parsed.fingerprint,
      publicKeyLine: publicKey,
    };
    const plan = createDeploymentPlan(publicKey, 'profile-id', 'deployment-id');

    await assert.rejects(
      new AuthorizedKeysService().deploy(
        sftp,
        key,
        { home: '/home/test', uid: 1000, gid: 1000 },
        plan,
      ),
      (error: unknown) => error instanceof DomainError && error.code === 'AUTHORIZED_KEYS_LOCKED',
    );
    assert.equal(unlinkCalls, 0);
    assert.equal(rmdirCalls, 0);
  });

  test('treats a missing managed authorized_keys file as already revoked', async () => {
    const directoryStats = createStats(0o040700);
    const ownerStats = { ...createStats(0o100600), size: 36 };
    let lockOwner = Buffer.alloc(0);
    const missing = Object.assign(new Error('missing'), { code: 2 });
    const sftp = {
      lstat(remotePath: string, callback: (error: Error | undefined, stats?: Stats) => void) {
        if (remotePath.endsWith('/.ssh')) {
          callback(undefined, directoryStats);
        } else if (remotePath.endsWith('/owner')) {
          callback(undefined, ownerStats);
        } else {
          callback(missing);
        }
      },
      mkdir(
        _remotePath: string,
        _attributes: { readonly mode: number },
        callback: (error?: Error) => void,
      ) {
        callback();
      },
      writeFile(
        _remotePath: string,
        content: Buffer,
        _options: object,
        callback: (error?: Error) => void,
      ) {
        lockOwner = Buffer.from(content);
        callback();
      },
      readFile(
        _remotePath: string,
        callback: (error: Error | undefined, content?: Buffer) => void,
      ) {
        callback(undefined, lockOwner);
      },
      unlink(_remotePath: string, callback: (error?: Error) => void) {
        callback();
      },
      rmdir(_remotePath: string, callback: (error?: Error) => void) {
        callback();
      },
    } as unknown as SFTPWrapper;
    const plan = createDeploymentPlan(publicKey, 'profile-id', 'deployment-id');

    assert.equal(
      await new AuthorizedKeysService().revoke(
        sftp,
        {
          schemaVersion: 1,
          id: '00000000-0000-4000-8000-000000000001',
          name: 'Test',
          alias: 'test',
          host: '192.0.2.10',
          port: 22,
          username: 'developer',
          platform: 'linux',
          keyStrategy: {
            kind: 'generated-per-host',
            keyId: '00000000-0000-4000-8000-000000000002',
          },
          authorization: plan,
        },
        { home: '/home/test', uid: 1000, gid: 1000 },
      ),
      true,
    );
  });
});

suite('AuthorizedKeysService remote layout', () => {
  test('deploys a managed key for root while preserving a safe 755/644 layout', async () => {
    const sshDirectory = '/root/.ssh';
    const target = `${sshDirectory}/authorized_keys`;
    const existing = Buffer.from('# existing access\n');
    const remote = createInMemorySftp(0, sshDirectory, 0o755, target, existing, 0o644);
    const parsed = parsePublicKeyLine(publicKey);
    const key = {
      keyId: 'root-test',
      privateKeyPath: 'unused',
      fingerprint: parsed.fingerprint,
      publicKeyLine: publicKey,
    };
    const plan = createDeploymentPlan(publicKey, 'profile-id', 'deployment-id');

    const authorization = await new AuthorizedKeysService().deploy(
      remote.sftp,
      key,
      { home: '/root', uid: 0, gid: 0 },
      plan,
    );

    assert.equal(authorization.ownership, 'managed');
    assert.equal(remote.read(target).subarray(0, existing.length).equals(existing), true);
    assert.equal(remote.read(target).toString('utf8').includes(plan.deploymentMarker), true);
    assert.equal(remote.mode(target), 0o100644);
    assert.equal(remote.has(`${sshDirectory}/.ssh-onboard.lock`), false);
  });

  test('converges without a duplicate after rename succeeds and post-write inspection fails', async () => {
    const sshDirectory = '/root/.ssh';
    const target = `${sshDirectory}/authorized_keys`;
    const remote = createInMemorySftp(
      0,
      sshDirectory,
      0o700,
      target,
      Buffer.from('# existing\n'),
      0o600,
    );
    const parsed = parsePublicKeyLine(publicKey);
    const key = {
      keyId: 'root-test',
      privateKeyPath: 'unused',
      fingerprint: parsed.fingerprint,
      publicKeyLine: publicKey,
    };
    const plan = createDeploymentPlan(publicKey, 'profile-id', 'deployment-id');
    remote.failNextPostRenameRead();

    await assert.rejects(
      new AuthorizedKeysService().deploy(remote.sftp, key, { home: '/root', uid: 0, gid: 0 }, plan),
      hasLayoutReason('sftp-read-failed'),
    );
    assert.equal(countOccurrences(remote.read(target).toString('utf8'), plan.deploymentMarker), 1);

    const authorization = await new AuthorizedKeysService().deploy(
      remote.sftp,
      key,
      { home: '/root', uid: 0, gid: 0 },
      plan,
    );
    assert.equal(authorization.ownership, 'managed');
    assert.equal(countOccurrences(remote.read(target).toString('utf8'), plan.deploymentMarker), 1);
  });

  test('converges revocation after rename succeeds and post-write inspection fails', async () => {
    const sshDirectory = '/root/.ssh';
    const target = `${sshDirectory}/authorized_keys`;
    const remote = createInMemorySftp(0, sshDirectory, 0o700, target, Buffer.alloc(0), 0o600);
    const parsed = parsePublicKeyLine(publicKey);
    const key = {
      keyId: 'root-test',
      privateKeyPath: 'unused',
      fingerprint: parsed.fingerprint,
      publicKeyLine: publicKey,
    };
    const plan = createDeploymentPlan(publicKey, 'profile-id', 'deployment-id');
    const authorization = await new AuthorizedKeysService().deploy(
      remote.sftp,
      key,
      { home: '/root', uid: 0, gid: 0 },
      plan,
    );
    assert.equal(authorization.ownership, 'managed');
    remote.failNextPostRenameRead();

    await assert.rejects(
      new AuthorizedKeysService().revoke(remote.sftp, createProfileWithAuthorization(plan), {
        home: '/root',
        uid: 0,
        gid: 0,
      }),
      hasLayoutReason('sftp-read-failed'),
    );
    assert.equal(remote.read(target).toString('utf8').includes(plan.deploymentMarker), false);
    assert.equal(
      await new AuthorizedKeysService().revoke(remote.sftp, createProfileWithAuthorization(plan), {
        home: '/root',
        uid: 0,
        gid: 0,
      }),
      true,
    );
  });

  test('performs no remote mutation when the SSH directory is group-writable', async () => {
    let mutationCalls = 0;
    const unsafeDirectory = createStats(0o040770, 0, 0);
    const sftp = {
      lstat(_remotePath: string, callback: (error: Error | undefined, stats?: Stats) => void) {
        callback(undefined, unsafeDirectory);
      },
      mkdir() {
        mutationCalls += 1;
      },
      writeFile() {
        mutationCalls += 1;
      },
      open() {
        mutationCalls += 1;
      },
      rename() {
        mutationCalls += 1;
      },
      unlink() {
        mutationCalls += 1;
      },
    } as unknown as SFTPWrapper;
    const parsed = parsePublicKeyLine(publicKey);

    await assert.rejects(
      new AuthorizedKeysService().deploy(
        sftp,
        {
          keyId: 'root-test',
          privateKeyPath: 'unused',
          fingerprint: parsed.fingerprint,
          publicKeyLine: publicKey,
        },
        { home: '/root', uid: 0, gid: 0 },
        createDeploymentPlan(publicKey, 'profile-id', 'deployment-id'),
      ),
      hasLayoutReason('ssh-directory-permissions'),
    );
    assert.equal(mutationCalls, 0);
  });

  test('accepts root-owned recommended and OpenSSH-safe common modes', () => {
    assert.doesNotThrow(() => assertSafeSshDirectory(createStats(0o040700, 0, 0), 0));
    assert.doesNotThrow(() => assertSafeSshDirectory(createStats(0o040755, 0, 0), 0));
    assert.doesNotThrow(() => assertSafeAuthorizedKeysFile(createStats(0o100600, 0, 0), 0));
    assert.doesNotThrow(() => assertSafeAuthorizedKeysFile(createStats(0o100644, 0, 0), 0));
    assert.doesNotThrow(() =>
      assertSafeAuthorizedKeysFile(createStats(0o100640, 1000, 2000), 1000),
    );
  });

  test('rejects group-writable SSH paths without rejecting harmless read access', () => {
    assert.throws(
      () => assertSafeSshDirectory(createStats(0o040770), 1000),
      hasLayoutReason('ssh-directory-permissions'),
    );
    assert.throws(
      () => assertSafeAuthorizedKeysFile(createStats(0o100660), 1000),
      hasLayoutReason('authorized-keys-permissions'),
    );
  });

  test('rejects foreign owners and links for both root and ordinary users', () => {
    assert.throws(
      () => assertSafeSshDirectory(createStats(0o040700, 1001), 1000),
      hasLayoutReason('ssh-directory-owner'),
    );
    assert.throws(
      () => assertSafeAuthorizedKeysFile(createStats(0o120777, 0, 0), 0),
      hasLayoutReason('authorized-keys-type'),
    );
  });
});

function createStats(mode: number, uid = 1000, gid = 1000): Stats {
  return {
    mode,
    uid,
    gid,
    size: 0,
    atime: 0,
    mtime: 0,
    isDirectory: () => (mode & 0o170000) === 0o040000,
    isFile: () => (mode & 0o170000) === 0o100000,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  };
}

function hasLayoutReason(reason: string): (error: unknown) => boolean {
  return (error: unknown) =>
    error instanceof DomainError &&
    error.code === 'REMOTE_LAYOUT_UNSAFE' &&
    error.detail === reason;
}

function createInMemorySftp(
  uid: number,
  directoryPath: string,
  directoryMode: number,
  filePath: string,
  fileContent: Buffer,
  fileMode: number,
): {
  readonly failNextPostRenameRead: () => void;
  readonly sftp: SFTPWrapper;
  readonly read: (remotePath: string) => Buffer;
  readonly mode: (remotePath: string) => number;
  readonly has: (remotePath: string) => boolean;
} {
  interface Entry {
    content?: Buffer;
    gid: number;
    mode: number;
    mtime: number;
    uid: number;
  }
  const entries = new Map<string, Entry>([
    [directoryPath, { gid: uid, mode: 0o040000 | directoryMode, mtime: 1, uid }],
    [
      filePath,
      {
        content: Buffer.from(fileContent),
        gid: uid,
        mode: 0o100000 | fileMode,
        mtime: 1,
        uid,
      },
    ],
  ]);
  let targetRenameCount = 0;
  let failReadAfterRename: number | undefined;
  const missing = () => Object.assign(new Error('missing'), { code: 2 });
  const handlePath = (handle: Buffer) => handle.toString('utf8');
  const sftp = {
    lstat(remotePath: string, callback: (error: Error | undefined, stats?: Stats) => void) {
      const entry = entries.get(remotePath);
      callback(entry === undefined ? missing() : undefined, entry && statsFromEntry(entry));
    },
    mkdir(
      remotePath: string,
      attributes: { readonly mode: number },
      callback: (error?: Error) => void,
    ) {
      if (entries.has(remotePath)) {
        callback(new Error('exists'));
        return;
      }
      entries.set(remotePath, {
        gid: uid,
        mode: 0o040000 | attributes.mode,
        mtime: 1,
        uid,
      });
      callback();
    },
    writeFile(
      remotePath: string,
      content: Buffer,
      options: { readonly mode: number },
      callback: (error?: Error) => void,
    ) {
      if (entries.has(remotePath)) {
        callback(new Error('exists'));
        return;
      }
      entries.set(remotePath, {
        content: Buffer.from(content),
        gid: uid,
        mode: 0o100000 | options.mode,
        mtime: 1,
        uid,
      });
      callback();
    },
    readFile(remotePath: string, callback: (error: Error | undefined, content?: Buffer) => void) {
      if (
        remotePath === filePath &&
        failReadAfterRename !== undefined &&
        targetRenameCount >= failReadAfterRename
      ) {
        failReadAfterRename = undefined;
        callback(new Error('post-rename read failed'));
        return;
      }
      const entry = entries.get(remotePath);
      callback(
        entry?.content === undefined ? missing() : undefined,
        entry?.content === undefined ? undefined : Buffer.from(entry.content),
      );
    },
    open(
      remotePath: string,
      _flags: string,
      attributes: { readonly mode: number },
      callback: (error: Error | undefined, handle?: Buffer) => void,
    ) {
      if (entries.has(remotePath)) {
        callback(new Error('exists'));
        return;
      }
      entries.set(remotePath, {
        content: Buffer.alloc(0),
        gid: uid,
        mode: 0o100000 | attributes.mode,
        mtime: 1,
        uid,
      });
      callback(undefined, Buffer.from(remotePath));
    },
    write(
      handle: Buffer,
      content: Buffer,
      offset: number,
      length: number,
      position: number,
      callback: (error?: Error) => void,
    ) {
      const entry = entries.get(handlePath(handle));
      if (entry?.content === undefined) {
        callback(missing());
        return;
      }
      const next = Buffer.alloc(Math.max(entry.content.length, position + length));
      entry.content.copy(next);
      content.copy(next, position, offset, offset + length);
      entry.content = next;
      callback();
    },
    ext_openssh_fsync(_handle: Buffer, callback: (error?: Error) => void) {
      callback();
    },
    close(_handle: Buffer, callback: (error?: Error) => void) {
      callback();
    },
    chmod(remotePath: string, mode: number, callback: (error?: Error) => void) {
      const entry = entries.get(remotePath);
      if (entry === undefined) {
        callback(missing());
        return;
      }
      entry.mode = (entry.mode & 0o170000) | mode;
      callback();
    },
    ext_openssh_rename(from: string, to: string, callback: (error?: Error) => void) {
      const entry = entries.get(from);
      if (entry === undefined) {
        callback(missing());
        return;
      }
      entries.set(to, {
        ...entry,
        ...(entry.content === undefined ? {} : { content: Buffer.from(entry.content) }),
        mtime: 2,
      });
      entries.delete(from);
      if (to === filePath) {
        targetRenameCount += 1;
      }
      callback();
    },
    unlink(remotePath: string, callback: (error?: Error) => void) {
      callback(entries.delete(remotePath) ? undefined : missing());
    },
    rmdir(remotePath: string, callback: (error?: Error) => void) {
      callback(entries.delete(remotePath) ? undefined : missing());
    },
  } as unknown as SFTPWrapper;
  return {
    sftp,
    failNextPostRenameRead: () => {
      failReadAfterRename = targetRenameCount + 1;
    },
    read: (remotePath) => Buffer.from(entries.get(remotePath)?.content ?? Buffer.alloc(0)),
    mode: (remotePath) => entries.get(remotePath)?.mode ?? 0,
    has: (remotePath) => entries.has(remotePath),
  };
}

function createProfileWithAuthorization(
  authorization: ReturnType<typeof createDeploymentPlan>,
): Parameters<AuthorizedKeysService['revoke']>[1] {
  return {
    schemaVersion: 1,
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Root test',
    alias: 'root-test',
    host: '192.0.2.10',
    port: 22,
    username: 'root',
    platform: 'linux',
    keyStrategy: {
      kind: 'generated-per-host',
      keyId: '00000000-0000-4000-8000-000000000002',
    },
    authorization,
  };
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function statsFromEntry(entry: {
  readonly content?: Buffer;
  readonly gid: number;
  readonly mode: number;
  readonly mtime: number;
  readonly uid: number;
}): Stats {
  return {
    ...createStats(entry.mode, entry.uid, entry.gid),
    size: entry.content?.length ?? 0,
    mtime: entry.mtime,
  };
}
