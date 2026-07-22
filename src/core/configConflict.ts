export const CONFIG_CONFLICT_REASONS = [
  'alias-in-use',
  'authorization-requires-revoke',
  'remote-setting-workspace',
  'remote-setting-invalid',
  'include-conflict',
  'managed-file-external-change',
  'managed-state-invalid',
  'lock-busy',
  'concurrent-change',
  'unsafe-config-file',
  'config-verification-failed',
  'unknown',
] as const;

export type ConfigConflictReason = (typeof CONFIG_CONFLICT_REASONS)[number];

export function configConflictReason(detail: string | undefined): ConfigConflictReason {
  if (detail === 'alias') {
    return 'alias-in-use';
  }
  if (detail === 'revoke-before-edit' || detail === 'revoke-before-remove') {
    return 'authorization-requires-revoke';
  }
  if (detail?.endsWith(':workspace') === true) {
    return 'remote-setting-workspace';
  }
  if (detail === 'remote.SSH.path' || detail === 'remote.SSH.configFile') {
    return 'remote-setting-invalid';
  }
  if (
    detail === 'managed-include' ||
    detail === 'duplicate-managed-include' ||
    detail === 'managed-include-path'
  ) {
    return 'include-conflict';
  }
  if (detail === 'known-hosts-external-change' || detail === 'managed-config-external-change') {
    return 'managed-file-external-change';
  }
  if (detail === 'managed-state' || detail === 'managed-state-owner') {
    return 'managed-state-invalid';
  }
  if (
    detail === 'lock' ||
    detail === 'profile-lock' ||
    detail === 'profile-lock-timeout' ||
    detail === 'profile-operation-lock' ||
    detail === 'profile-operation-in-progress' ||
    detail === 'configuration-operation-lock' ||
    detail === 'configuration-operation-in-progress'
  ) {
    return 'lock-busy';
  }
  if (detail === 'concurrent-change') {
    return 'concurrent-change';
  }
  if (detail === 'unsafe-file' || detail === 'unsupported-encoding' || detail === 'path') {
    return 'unsafe-config-file';
  }
  if (detail?.startsWith('expanded-config:') === true || detail?.startsWith('exit:') === true) {
    return 'config-verification-failed';
  }
  return 'unknown';
}
