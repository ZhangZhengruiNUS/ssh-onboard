import * as assert from 'node:assert/strict';

import { DomainError, normalizeDomainError } from '../../core/domainError';

suite('DomainError', () => {
  test('preserves an approved domain error code', () => {
    const error = normalizeDomainError(new DomainError('REMOTE_SSH_UNAVAILABLE'));

    assert.equal(error.code, 'REMOTE_SSH_UNAVAILABLE');
  });

  test('does not expose an unexpected raw error message', () => {
    const secret = 'server-password-should-not-leak';
    const error = normalizeDomainError(new Error(secret));

    assert.equal(error.code, 'UNEXPECTED');
    assert.equal(error.message, 'UNEXPECTED');
    assert.equal(error.message.includes(secret), false);
  });
});
