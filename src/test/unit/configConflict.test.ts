import * as assert from 'node:assert/strict';

import { configConflictReason } from '../../core/configConflict';

suite('Config conflict reasons', () => {
  test('distinguishes workspace settings and managed-state failures', () => {
    assert.equal(
      configConflictReason('remote.SSH.configFile:workspace'),
      'remote-setting-workspace',
    );
    assert.equal(configConflictReason('remote.SSH.path'), 'remote-setting-invalid');
    assert.equal(configConflictReason('alias'), 'alias-in-use');
    assert.equal(configConflictReason('managed-include'), 'include-conflict');
    assert.equal(
      configConflictReason('known-hosts-external-change'),
      'managed-file-external-change',
    );
    assert.equal(configConflictReason('managed-state'), 'managed-state-invalid');
    assert.equal(configConflictReason('managed-state-owner'), 'managed-state-invalid');
    assert.equal(configConflictReason('configuration-operation-in-progress'), 'lock-busy');
    assert.equal(configConflictReason('concurrent-change'), 'concurrent-change');
    assert.equal(configConflictReason('unsafe-file'), 'unsafe-config-file');
    assert.equal(configConflictReason('expanded-config:hostname'), 'config-verification-failed');
  });

  test('does not expose unknown internal detail strings', () => {
    assert.equal(configConflictReason('secret-path-or-output'), 'unknown');
  });
});
