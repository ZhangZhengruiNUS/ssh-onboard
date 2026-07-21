import type { DomainErrorCode } from '../core/domainError';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type SafeLogStage =
  | 'activation'
  | 'add-host'
  | 'connect-host'
  | 'edit-host'
  | 'export-profiles'
  | 'initialize-host'
  | 'remote-ssh-detection'
  | 'remove-host'
  | 'revoke-key'
  | 'search-hosts'
  | 'show-diagnostics'
  | 'test-connection';

export interface SafeLogEvent {
  readonly code?: DomainErrorCode;
  readonly correlationId?: string;
  readonly stage: SafeLogStage;
}

export function sanitizeLogEvent(event: SafeLogEvent): Readonly<Record<string, string>> {
  const safe: Record<string, string> = {
    stage: event.stage,
  };

  if (event.code !== undefined) {
    safe.code = event.code;
  }
  if (event.correlationId !== undefined) {
    safe.correlationId = UUID.test(event.correlationId) ? event.correlationId : '[redacted]';
  }

  return safe;
}

export function serializeLogEvent(event: SafeLogEvent): string {
  return JSON.stringify(sanitizeLogEvent(event));
}
