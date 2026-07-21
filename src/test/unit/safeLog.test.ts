import * as assert from 'node:assert/strict';

import { sanitizeLogEvent, serializeLogEvent } from '../../logging/safeLog';

suite('Safe log metadata', () => {
  test('keeps only the fixed allowlisted fields', () => {
    const event = sanitizeLogEvent({
      code: 'UNEXPECTED',
      correlationId: '123e4567-e89b-12d3-a456-426614174000',
      stage: 'activation',
    });

    assert.deepEqual(event, {
      code: 'UNEXPECTED',
      correlationId: '123e4567-e89b-12d3-a456-426614174000',
      stage: 'activation',
    });
  });

  test('redacts unsafe identifiers instead of logging their content', () => {
    const secret = 'Password123456';
    const serialized = serializeLogEvent({ correlationId: secret, stage: 'add-host' });

    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes('[redacted]'), true);
  });
});
