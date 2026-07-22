import * as assert from 'node:assert/strict';

import {
  HostKeyReviewProtocolError,
  MAX_HOST_KEY_REVIEW_MESSAGE_BYTES,
  parseHostKeyReviewMessage,
} from '../../webview/hostKeyReviewProtocol';

const sessionId = '00000000-0000-4000-8000-000000000001';

suite('Host key review protocol', () => {
  test('accepts ready, copy, first-use trust, verification, and cancel messages', () => {
    assert.deepEqual(parseHostKeyReviewMessage({ type: 'ready' }), { type: 'ready' });
    assert.deepEqual(parseHostKeyReviewMessage({ type: 'copy', sessionId }), {
      type: 'copy',
      sessionId,
    });
    assert.deepEqual(parseHostKeyReviewMessage({ type: 'trust', sessionId }), {
      type: 'trust',
      sessionId,
    });
    assert.deepEqual(
      parseHostKeyReviewMessage({
        type: 'verify',
        sessionId,
        expectedFingerprint: 'SHA256:expected',
      }),
      { type: 'verify', sessionId, expectedFingerprint: 'SHA256:expected' },
    );
    assert.deepEqual(parseHostKeyReviewMessage({ type: 'cancel', sessionId }), {
      type: 'cancel',
      sessionId,
    });
  });

  test('rejects unknown fields, forged sessions, and oversized messages', () => {
    assert.throws(
      () => parseHostKeyReviewMessage({ type: 'trust', sessionId, fingerprint: 'forged' }),
      HostKeyReviewProtocolError,
    );
    assert.throws(
      () => parseHostKeyReviewMessage({ type: 'trust', sessionId: 'not-a-session' }),
      HostKeyReviewProtocolError,
    );
    assert.throws(
      () =>
        parseHostKeyReviewMessage({
          type: 'verify',
          sessionId,
          expectedFingerprint: 'x'.repeat(MAX_HOST_KEY_REVIEW_MESSAGE_BYTES),
        }),
      (error: unknown) =>
        error instanceof HostKeyReviewProtocolError && error.reason === 'oversize',
    );
  });
});
