export const DOMAIN_ERROR_CODES = [
  'CANCELLED',
  'FEATURE_UNAVAILABLE',
  'REMOTE_SSH_UNAVAILABLE',
  'UNEXPECTED',
  'UNSUPPORTED_PLATFORM',
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export class DomainError extends Error {
  public override readonly name = 'DomainError';

  public constructor(public readonly code: DomainErrorCode) {
    super(code);
  }
}

export function normalizeDomainError(error: unknown): DomainError {
  return error instanceof DomainError ? error : new DomainError('UNEXPECTED');
}
