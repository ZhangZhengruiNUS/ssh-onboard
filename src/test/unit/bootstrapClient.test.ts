import * as assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createServer as createTcpServer, type Socket } from 'node:net';

import { Server, type AuthContext, type Connection } from 'ssh2';

import { DomainError } from '../../core/domainError';
import type { ServerProfile, TrustedHostKey } from '../../domain/profiles';
import { knownHostsAddress } from '../../domain/hostKeys';
import { BootstrapClient } from '../../services/bootstrapClient';

const profileBase: Omit<ServerProfile, 'port'> = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Loopback',
  alias: 'loopback',
  host: '127.0.0.1',
  username: 'developer',
  platform: 'linux',
  keyStrategy: { kind: 'generated-per-host', keyId: '00000000-0000-4000-8000-000000000002' },
};

suite('BootstrapClient', function () {
  this.timeout(15_000);

  test('does not attempt user authentication while probing the host key', async () => {
    const fixture = await startSshServer('canary-password');
    try {
      const profile: ServerProfile = { ...profileBase, port: fixture.port };
      const bootstrap = new BootstrapClient();
      const observed = await bootstrap.probeHostKey(profile);

      assert.equal(observed.algorithm, 'ssh-rsa');
      assert.equal(fixture.authenticationAttempts.length, 0);
    } finally {
      await fixture.close();
    }
  });

  test('stops before connecting when host-key discovery is cancelled', async () => {
    const abort = new AbortController();
    abort.abort();
    const profile: ServerProfile = { ...profileBase, port: 22 };

    await assert.rejects(
      new BootstrapClient().probeHostKey(profile, abort.signal),
      (error: unknown) => error instanceof DomainError && error.code === 'CANCELLED',
    );
  });

  test('destroys an active discovery socket when cancelled', async () => {
    let acceptedSocket: Socket | undefined;
    let acceptConnection: (() => void) | undefined;
    const accepted = new Promise<void>((resolve) => {
      acceptConnection = resolve;
    });
    const server = createTcpServer((socket) => {
      acceptedSocket = socket;
      acceptConnection?.();
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, 'object');
    if (address === null || typeof address === 'string') {
      throw new Error('Unable to allocate loopback TCP port.');
    }
    const abort = new AbortController();
    const probe = new BootstrapClient().probeHostKey(
      { ...profileBase, port: address.port },
      abort.signal,
    );
    await accepted;
    const socketClosed = new Promise<void>((resolve) => acceptedSocket?.once('close', resolve));
    abort.abort();

    await assert.rejects(
      probe,
      (error: unknown) => error instanceof DomainError && error.code === 'CANCELLED',
    );
    await socketClosed;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('uses exactly one password authentication after the exact host key is trusted', async () => {
    const password = 'canary-password';
    const fixture = await startSshServer(password);
    try {
      const profile: ServerProfile = { ...profileBase, port: fixture.port };
      const bootstrap = new BootstrapClient();
      const observed = await bootstrap.probeHostKey(profile);
      const trust: TrustedHostKey = {
        ...observed,
        knownHostsHost: knownHostsAddress(profile.host, profile.port),
        trustedAt: new Date().toISOString(),
      };
      const client = await bootstrap.connectWithPassword(profile, password, trust);
      client.end();

      assert.deepEqual(fixture.authenticationAttempts, [{ method: 'password', password }]);
    } finally {
      await fixture.close();
    }
  });
});

interface SshServerFixture {
  readonly port: number;
  readonly authenticationAttempts: Array<{ readonly method: string; readonly password?: string }>;
  close(): Promise<void>;
}

async function startSshServer(expectedPassword: string): Promise<SshServerFixture> {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const authenticationAttempts: Array<{ readonly method: string; readonly password?: string }> = [];
  const connections = new Set<Connection>();
  const server = new Server({ hostKeys: [privateKey] }, (client) => {
    connections.add(client);
    client.on('error', () => connections.delete(client));
    client.on('authentication', (context: AuthContext) => {
      const password = context.method === 'password' ? context.password : undefined;
      authenticationAttempts.push({
        method: context.method,
        ...(password === undefined ? {} : { password }),
      });
      if (context.method === 'password' && context.password === expectedPassword) {
        context.accept();
      } else {
        context.reject(['password'], false);
      }
    });
    client.on('end', () => connections.delete(client));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Unable to allocate loopback SSH port.');
  }
  return {
    port: address.port,
    authenticationAttempts,
    close: async () => {
      for (const connection of connections) {
        connection.end();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
