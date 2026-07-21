import * as assert from 'node:assert/strict';

import { DomainError } from '../../core/domainError';
import {
  assertNoAliasConflict,
  decodeUtf8Config,
  ensureManagedInclude,
  renderKnownHosts,
  renderManagedConfig,
} from '../../domain/sshConfig';
import type { ServerProfile } from '../../domain/profiles';

const profile: ServerProfile = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Host A',
  alias: 'host-a',
  host: '192.0.2.10',
  port: 22,
  username: 'developer',
  platform: 'linux',
  keyStrategy: { kind: 'generated-per-host', keyId: '00000000-0000-4000-8000-000000000002' },
  localKey: {
    keyId: '00000000-0000-4000-8000-000000000002',
    privateKeyPath: 'C:\\Users\\Example User\\.ssh\\key',
    publicKeyPath: 'C:\\Users\\Example User\\.ssh\\key.pub',
    fingerprint: 'SHA256:key',
    publicKeyLine: 'ssh-ed25519 AAAA comment',
  },
  trustedHostKey: {
    algorithm: 'ssh-ed25519',
    fingerprint: 'SHA256:host',
    keyBase64: 'AAAA',
    knownHostsHost: '192.0.2.10',
    trustedAt: '2026-01-01T00:00:00.000Z',
  },
  authorization: {
    ownership: 'external',
    fingerprint: 'SHA256:key',
    detectedAt: '2026-01-01T00:00:00.000Z',
  },
};

suite('SSH config transforms', () => {
  test('inserts Include before the first active directive and preserves BOM/CRLF', () => {
    const source = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('# comment\r\nHost existing\r\n    User dev\r\n', 'utf8'),
    ]);
    const result = ensureManagedInclude(source);
    const decoded = decodeUtf8Config(result.content);

    assert.equal(decoded.bom, true);
    assert.equal(decoded.newline, '\r\n');
    assert.equal(
      decoded.text,
      '# comment\r\nInclude "ssh-onboard/config"\r\nHost existing\r\n    User dev\r\n',
    );
  });

  test('is idempotent and rejects ambiguous managed Include directives', () => {
    const once = ensureManagedInclude(Buffer.from('Host example\n', 'utf8')).content;
    assert.equal(ensureManagedInclude(once).changed, false);
    assert.throws(
      () =>
        ensureManagedInclude(
          Buffer.from('Include "ssh-onboard/config"\nInclude "ssh-onboard/config"\n', 'utf8'),
        ),
      DomainError,
    );
    assert.throws(
      () => ensureManagedInclude(Buffer.from('Include other/ssh-onboard/config\n', 'utf8')),
      DomainError,
    );
  });

  test('detects an exact pre-existing alias but ignores wildcard patterns', () => {
    assert.throws(
      () => assertNoAliasConflict(Buffer.from('Host host-a\n', 'utf8'), ['host-a']),
      DomainError,
    );
    assert.doesNotThrow(() => assertNoAliasConflict(Buffer.from('Host *\n', 'utf8'), ['host-a']));
  });

  test('renders a fail-closed managed block with a quoted Windows path', () => {
    const rendered = renderManagedConfig([profile], 'C:\\Users\\Example User\\.ssh\\known_hosts');
    assert.match(rendered, /IdentityFile "C:\/Users\/Example User\/\.ssh\/key"/u);
    assert.match(rendered, /PasswordAuthentication no/u);
    assert.match(rendered, /StrictHostKeyChecking yes/u);
    assert.match(rendered, /ProxyCommand none/u);
    assert.match(rendered, /ControlMaster no/u);
    assert.match(rendered, /HostKeyAlias ssh-onboard-00000000-0000-4000-8000-000000000001/u);
  });

  test('does not render a Host block before remote authorization is proven', () => {
    const uninitialized = { ...profile };
    Reflect.deleteProperty(uninitialized, 'authorization');

    assert.equal(renderManagedConfig([uninitialized], 'C:\\known_hosts'), '');
    assert.match(renderKnownHosts([uninitialized]), /^ssh-onboard-/u);
  });

  test('isolates host trust by profile even when endpoints are identical', () => {
    const second: ServerProfile = {
      ...profile,
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Host B',
      alias: 'host-b',
      trustedHostKey: {
        ...profile.trustedHostKey!,
        keyBase64: 'BBBB',
        fingerprint: 'SHA256:other',
      },
    };
    const knownHosts = renderKnownHosts([profile, second]);

    assert.match(
      knownHosts,
      /^ssh-onboard-00000000-0000-4000-8000-000000000001 ssh-ed25519 AAAA$/mu,
    );
    assert.match(
      knownHosts,
      /^ssh-onboard-00000000-0000-4000-8000-000000000003 ssh-ed25519 BBBB$/mu,
    );
  });
});
