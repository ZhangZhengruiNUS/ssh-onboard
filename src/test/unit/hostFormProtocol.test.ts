import * as assert from 'node:assert/strict';

import type { ServerProfile } from '../../domain/profiles';
import { profileToHostFormDraftDto } from '../../webview/hostFormModel';
import {
  HostFormProtocolError,
  MAX_HOST_FORM_MESSAGE_BYTES,
  assertHostFormDtoSafe,
  parseHostFormMessage,
  type HostFormDraftDto,
} from '../../webview/hostFormProtocol';

const draft: HostFormDraftDto = {
  name: 'Server',
  host: '192.0.2.10',
  port: 22,
  username: 'developer',
  alias: 'server',
  defaultPath: '/srv/project',
  group: 'Development',
  keyStrategy: { kind: 'generated-per-host' },
};

suite('Host form protocol', () => {
  test('accepts an exact bounded save message', () => {
    assert.deepEqual(
      parseHostFormMessage({
        type: 'save',
        revision: '00000000-0000-4000-8000-000000000001',
        intent: 'save-and-initialize',
        draft,
      }),
      {
        type: 'save',
        revision: '00000000-0000-4000-8000-000000000001',
        intent: 'save-and-initialize',
        draft,
      },
    );
  });

  test('rejects unknown root and nested fields', () => {
    assert.throws(
      () =>
        parseHostFormMessage({
          type: 'save',
          revision: '00000000-0000-4000-8000-000000000001',
          intent: 'save-only',
          draft,
          privateKeyPath: 'C:\\secret',
        }),
      HostFormProtocolError,
    );
    assert.throws(
      () =>
        parseHostFormMessage({
          type: 'save',
          revision: '00000000-0000-4000-8000-000000000001',
          intent: 'save-only',
          draft: { ...draft, keyStrategy: { kind: 'generated-per-host', keyId: 'forged' } },
        }),
      HostFormProtocolError,
    );
    assert.throws(
      () =>
        parseHostFormMessage({
          type: 'save',
          revision: '00000000-0000-4000-8000-000000000001',
          intent: 'save-and-run-anything',
          draft,
        }),
      HostFormProtocolError,
    );
  });

  test('rejects messages larger than the fixed limit', () => {
    const oversized = {
      type: 'save',
      revision: '00000000-0000-4000-8000-000000000001',
      intent: 'save-only',
      draft: { ...draft, name: 'x'.repeat(MAX_HOST_FORM_MESSAGE_BYTES) },
    };
    assert.throws(
      () => parseHostFormMessage(oversized),
      (error: unknown) => error instanceof HostFormProtocolError && error.reason === 'oversize',
    );
  });

  test('never serializes private key paths or authorization material to the form', () => {
    const profile: ServerProfile = {
      schemaVersion: 1,
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Server',
      alias: 'server',
      host: '192.0.2.10',
      port: 22,
      username: 'developer',
      platform: 'linux',
      keyStrategy: { kind: 'existing', privateKeyPath: 'C:\\Users\\dev\\.ssh\\private_key' },
      authorization: {
        ownership: 'managed',
        fingerprint: 'SHA256:secret',
        deploymentMarker: 'secret-marker',
        deployedPublicKeyLine: 'ssh-ed25519 secret',
        deployedAt: '2026-07-22T00:00:00.000Z',
      },
    };
    const dto = profileToHostFormDraftDto(profile);
    assertHostFormDtoSafe(dto);
    const serialized = JSON.stringify(dto);
    assert.equal(serialized.includes('C:\\\\Users\\\\dev'), false);
    assert.equal(serialized.includes('secret-marker'), false);
    assert.equal(serialized.includes('SHA256:secret'), false);
    assert.deepEqual(dto.keyStrategy, { kind: 'existing', selectionLabel: 'private_key' });
  });
});
