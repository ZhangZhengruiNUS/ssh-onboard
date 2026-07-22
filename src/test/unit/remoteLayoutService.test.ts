import * as assert from 'node:assert/strict';

import { DomainError } from '../../core/domainError';
import { parseRemoteLayout } from '../../services/remoteLayoutService';

suite('RemoteLayoutService', () => {
  test('accepts the root account without weakening layout validation', () => {
    assert.deepEqual(parseRemoteLayout(layoutOutput('/root', '0', '0')), {
      home: '/root',
      uid: 0,
      gid: 0,
    });
  });

  test('accepts an ordinary Linux account', () => {
    assert.deepEqual(parseRemoteLayout(layoutOutput('/home/developer', '1000', '1000')), {
      home: '/home/developer',
      uid: 1000,
      gid: 1000,
    });
  });

  test('rejects malformed, relative, negative, and trailing output', () => {
    for (const value of [
      layoutOutput('home/developer', '1000', '1000'),
      layoutOutput('/home/developer', '-1', '1000'),
      layoutOutput('/home/developer', '1000', '-1'),
      Buffer.concat([layoutOutput('/home/developer', '1000', '1000'), Buffer.from('unexpected')]),
    ]) {
      assert.throws(
        () => parseRemoteLayout(value),
        (error: unknown) =>
          error instanceof DomainError &&
          error.code === 'REMOTE_LAYOUT_UNSAFE' &&
          error.detail === 'layout-values',
      );
    }
  });

  test('allows root to modify only the standard /root home', () => {
    for (const home of ['/', '/etc', '/root/', '/root/../etc']) {
      assert.throws(
        () => parseRemoteLayout(layoutOutput(home, '0', '0')),
        (error: unknown) =>
          error instanceof DomainError &&
          error.code === 'REMOTE_LAYOUT_UNSAFE' &&
          error.detail === 'root-home',
      );
    }
  });

  test('rejects non-canonical UID and GID output before numeric conversion', () => {
    for (const [uid, gid] of [
      ['', '0'],
      [' ', '0'],
      ['+0', '0'],
      ['-0', '0'],
      ['00', '0'],
      ['1e3', '0'],
      ['0', ' 0'],
      ['0', '+0'],
      ['0', '1e3'],
    ] as const) {
      assert.throws(
        () => parseRemoteLayout(layoutOutput('/root', uid, gid)),
        (error: unknown) =>
          error instanceof DomainError &&
          error.code === 'REMOTE_LAYOUT_UNSAFE' &&
          error.detail === 'layout-values',
      );
    }
  });
});

function layoutOutput(home: string, uid: string, gid: string): Buffer {
  return Buffer.from([home, uid, gid, ''].join('\0'));
}
