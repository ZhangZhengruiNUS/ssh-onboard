export const DOMAIN_ERROR_CODES = [
  'AUTH_FAILED',
  'AUTHORIZED_KEYS_LOCKED',
  'AUTHORIZED_KEYS_WRITE_FAILED',
  'CANCELLED',
  'DEFAULT_PATH_INVALID',
  'FEATURE_UNAVAILABLE',
  'HOST_KEY_CHANGED',
  'HOST_KEY_UNTRUSTED',
  'INVALID_PROFILE',
  'KEY_GENERATION_FAILED',
  'KEY_VERIFICATION_FAILED',
  'LOCAL_CONFIG_CONFLICT',
  'PREREQUISITE_MISSING',
  'PROFILE_NOT_FOUND',
  'REMOTE_LAYOUT_UNSAFE',
  'REMOTE_SSH_LAUNCH_FAILED',
  'REMOTE_SSH_UNAVAILABLE',
  'UNEXPECTED',
  'UNSUPPORTED_PLATFORM',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export class DomainError extends Error {
  public override readonly name = 'DomainError';

  public constructor(
    public readonly code: DomainErrorCode,
    public readonly detail?: string,
  ) {
    super(code);
  }
}

export function normalizeDomainError(error: unknown): DomainError {
  return error instanceof DomainError ? error : new DomainError('UNEXPECTED');
}
