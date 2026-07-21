import * as assert from 'node:assert/strict';

import type { SFTPWrapper, Stats } from 'ssh2';

import { DomainError } from '../../core/domainError';
import { createDeploymentPlan } from '../../domain/authorizedKeys';
import { parsePublicKeyLine } from '../../domain/keys';
import { AuthorizedKeysService } from '../../services/authorizedKeysService';

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

  test('fails revocation when the managed authorized_keys file is missing', async () => {
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

    await assert.rejects(
      new AuthorizedKeysService().revoke(
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
      (error: unknown) => error instanceof DomainError && error.detail === 'managed-line-missing',
    );
  });
});

function createStats(mode: number): Stats {
  return {
    mode,
    uid: 1000,
    gid: 1000,
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
