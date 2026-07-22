import * as assert from 'node:assert/strict';

import type { HostKeyObservation } from '../../domain/hostKeys';
import { classifyHostKey, trustObservedHostKey } from '../../domain/hostKeyTrust';
import type { ServerProfile } from '../../domain/profiles';

const profile: ServerProfile = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Server',
  alias: 'server',
  host: '192.0.2.10',
  port: 2222,
  username: 'developer',
  platform: 'linux',
  keyStrategy: { kind: 'generated-per-host', keyId: '00000000-0000-4000-8000-000000000002' },
};

const observation: HostKeyObservation = {
  algorithm: 'ssh-ed25519',
  fingerprint: 'SHA256:observed',
  keyBase64: 'AAAA',
};

suite('Host key trust decisions', () => {
  test('offers TOFU only when the host has no saved key', () => {
    assert.deepEqual(classifyHostKey(profile, observation), { kind: 'first-use' });
  });

  test('silently accepts only an exact algorithm, fingerprint, and key-blob match', () => {
    const trusted = trustObservedHostKey(profile, observation, '2026-07-22T00:00:00.000Z');
    assert.deepEqual(classifyHostKey({ ...profile, trustedHostKey: trusted }, observation), {
      kind: 'known',
      trusted,
    });
    for (const changed of [
      { ...observation, algorithm: 'ssh-rsa' },
      { ...observation, fingerprint: 'SHA256:changed' },
      { ...observation, keyBase64: 'BBBB' },
    ]) {
      assert.equal(
        classifyHostKey({ ...profile, trustedHostKey: trusted }, changed).kind,
        'changed',
      );
    }
  });

  test('formats non-default ports exactly for the isolated known_hosts file', () => {
    assert.equal(
      trustObservedHostKey(profile, observation, '2026-07-22T00:00:00.000Z').knownHostsHost,
      '[192.0.2.10]:2222',
    );
  });
});
