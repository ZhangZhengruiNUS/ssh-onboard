import * as assert from 'node:assert/strict';

import {
  getProfileStatus,
  isServerProfile,
  isValidHost,
  isValidRemotePath,
  validateProfileDraft,
  type ProfileDraft,
  type ServerProfile,
} from '../../domain/profiles';

const draft: ProfileDraft = {
  name: 'Test host',
  alias: 'test-host',
  host: '192.0.2.10',
  port: 22,
  username: 'developer',
  defaultPath: '/home/developer/project',
  group: 'Test',
  keyStrategy: { kind: 'generated-per-host', keyId: '00000000-0000-4000-8000-000000000001' },
};

const profile: ServerProfile = {
  ...draft,
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000002',
  platform: 'linux',
};

suite('Profile domain', () => {
  test('accepts IPv4, IPv6, and DNS names but rejects option and shell-like hosts', () => {
    assert.equal(isValidHost('192.0.2.10'), true);
    assert.equal(isValidHost('2001:db8::10'), true);
    assert.equal(isValidHost('build.example.test'), true);
    assert.equal(isValidHost('-oProxyCommand=calc'), false);
    assert.equal(isValidHost('host;whoami'), false);
    assert.equal(isValidHost('host\nname'), false);
  });

  test('requires an absolute control-character-free POSIX path', () => {
    assert.equal(isValidRemotePath('/home/user/a b/#/%'), true);
    assert.equal(isValidRemotePath('relative/path'), false);
    assert.equal(isValidRemotePath('/tmp/a\ncommand'), false);
  });

  test('reports invalid fields without executing or normalizing them', () => {
    assert.deepEqual(validateProfileDraft({ ...draft, alias: '../escape' }), ['alias']);
    assert.deepEqual(validateProfileDraft({ ...draft, username: 'user;id' }), ['username']);
    assert.deepEqual(validateProfileDraft({ ...draft, port: 0 }), ['port']);
  });

  test('deep-validates generated key IDs from persisted state', () => {
    assert.equal(isServerProfile(profile), true);
    assert.equal(
      isServerProfile({
        ...profile,
        keyStrategy: { kind: 'generated-per-host', keyId: '../../outside' },
      }),
      false,
    );
  });

  test('derives status from trust, authorization, verification, and failures', () => {
    assert.equal(getProfileStatus(profile), 'setup-required');
    const trusted: ServerProfile = {
      ...profile,
      trustedHostKey: {
        algorithm: 'ssh-ed25519',
        fingerprint: 'SHA256:test',
        keyBase64: 'AAAA',
        knownHostsHost: '192.0.2.10',
        trustedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    assert.equal(getProfileStatus(trusted), 'host-trusted');
    const ready: ServerProfile = {
      ...trusted,
      localKey: {
        keyId: '00000000-0000-4000-8000-000000000001',
        privateKeyPath: 'C:\\test',
        fingerprint: 'SHA256:key',
        publicKeyLine: 'ssh-ed25519 AAAA test',
      },
      authorization: {
        ownership: 'external',
        fingerprint: 'SHA256:key',
        detectedAt: '2026-01-01T00:00:00.000Z',
      },
      verificationContext: {
        sshPath: 'ssh.exe',
        configFile: 'config',
        keyFingerprint: 'SHA256:key',
        hostKeyFingerprint: 'SHA256:test',
      },
      lastVerifiedAt: '2026-01-01T00:00:00.000Z',
    };
    assert.equal(getProfileStatus(ready), 'ready');
    assert.equal(
      getProfileStatus({
        ...ready,
        trustedHostKey: { ...ready.trustedHostKey!, fingerprint: 'SHA256:changed' },
      }),
      'needs-attention',
    );
    assert.equal(getProfileStatus({ ...trusted, lastErrorCode: 'AUTH_FAILED' }), 'needs-attention');
  });
});
