import * as assert from 'node:assert/strict';

import type { ServerProfile } from '../../domain/profiles';
import { HostFormSession, HostFormSessionError } from '../../webview/hostFormSession';

const profile: ServerProfile = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Server',
  alias: 'server',
  host: '192.0.2.10',
  port: 22,
  username: 'developer',
  platform: 'linux',
  keyStrategy: { kind: 'generated-per-host', keyId: '00000000-0000-4000-8000-000000000002' },
};

suite('Host form session', () => {
  test('rejects stale revisions and stale profile edits', () => {
    const session = new HostFormSession('panel');
    const revision = session.start(profile);
    assert.throws(
      () => session.assertRevision('00000000-0000-4000-8000-000000000099'),
      (error: unknown) =>
        error instanceof HostFormSessionError && error.reason === 'stale-revision',
    );
    session.assertRevision(revision);
    assert.throws(
      () => session.assertProfile({ ...profile, name: 'Changed elsewhere' }),
      (error: unknown) => error instanceof HostFormSessionError && error.reason === 'stale-profile',
    );
  });

  test('binds selection tokens to one panel and rejects replay', () => {
    const first = new HostFormSession('first');
    const firstRevision = first.start(profile);
    const token = first.createExistingKeySelection(firstRevision, 'C:\\safe\\key');
    assert.throws(
      () => first.inspectExistingKeySelection(firstRevision, 'forged-token'),
      (error: unknown) => error instanceof HostFormSessionError && error.reason === 'invalid-token',
    );
    assert.equal(first.consumeExistingKeySelection(firstRevision, token), 'C:\\safe\\key');
    assert.throws(
      () => first.consumeExistingKeySelection(firstRevision, token),
      (error: unknown) =>
        error instanceof HostFormSessionError && error.reason === 'replayed-token',
    );

    const second = new HostFormSession('second');
    const secondRevision = second.start(profile);
    assert.throws(
      () => second.inspectExistingKeySelection(secondRevision, token),
      (error: unknown) => error instanceof HostFormSessionError && error.reason === 'invalid-token',
    );
  });

  test('rejects expired tokens', () => {
    let now = 1_000;
    const session = new HostFormSession('panel', () => now);
    const revision = session.start(profile);
    const token = session.createExistingKeySelection(revision, 'C:\\safe\\key');
    now += 11 * 60 * 1000;
    assert.throws(
      () => session.inspectExistingKeySelection(revision, token),
      (error: unknown) => error instanceof HostFormSessionError && error.reason === 'expired-token',
    );
  });
});
