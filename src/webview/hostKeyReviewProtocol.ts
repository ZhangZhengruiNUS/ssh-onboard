export const MAX_HOST_KEY_REVIEW_MESSAGE_BYTES = 16 * 1024;

export type HostKeyReviewMode = 'first-use' | 'changed';

export type HostKeyReviewToExtensionMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'copy'; readonly sessionId: string }
  | { readonly type: 'trust'; readonly sessionId: string }
  | {
      readonly type: 'verify';
      readonly sessionId: string;
      readonly expectedFingerprint: string;
    }
  | { readonly type: 'cancel'; readonly sessionId: string };

export type ExtensionToHostKeyReviewMessage =
  | {
      readonly type: 'initialize';
      readonly sessionId: string;
      readonly mode: HostKeyReviewMode;
      readonly displayName: string;
      readonly endpoint: string;
      readonly algorithm: string;
      readonly fingerprint: string;
      readonly previousAlgorithm?: string;
      readonly previousFingerprint?: string;
    }
  | { readonly type: 'copied'; readonly sessionId: string }
  | { readonly type: 'validationError'; readonly sessionId: string; readonly message: string };

export class HostKeyReviewProtocolError extends Error {
  public constructor(public readonly reason: 'invalid' | 'oversize') {
    super(`Host key review message rejected: ${reason}`);
    this.name = 'HostKeyReviewProtocolError';
  }
}

export function parseHostKeyReviewMessage(value: unknown): HostKeyReviewToExtensionMessage {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new HostKeyReviewProtocolError('invalid');
  }
  if (encoded === undefined) {
    throw new HostKeyReviewProtocolError('invalid');
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_HOST_KEY_REVIEW_MESSAGE_BYTES) {
    throw new HostKeyReviewProtocolError('oversize');
  }
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new HostKeyReviewProtocolError('invalid');
  }
  if (value.type === 'ready') {
    assertExactKeys(value, ['type']);
    return { type: 'ready' };
  }
  const sessionId = requiredSessionId(value.sessionId);
  switch (value.type) {
    case 'copy':
    case 'trust':
    case 'cancel':
      assertExactKeys(value, ['type', 'sessionId']);
      return { type: value.type, sessionId };
    case 'verify':
      assertExactKeys(value, ['type', 'sessionId', 'expectedFingerprint']);
      return {
        type: 'verify',
        sessionId,
        expectedFingerprint: requiredString(value.expectedFingerprint, 256),
      };
    default:
      throw new HostKeyReviewProtocolError('invalid');
  }
}

function requiredSessionId(value: unknown): string {
  const sessionId = requiredString(value, 36);
  if (!/^[0-9a-f-]{36}$/iu.test(sessionId)) {
    throw new HostKeyReviewProtocolError('invalid');
  }
  return sessionId;
}

function requiredString(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string' || value.length > maximumLength) {
    throw new HostKeyReviewProtocolError('invalid');
  }
  return value;
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const expected = new Set(allowed);
  if (
    Object.keys(value).some((key) => !expected.has(key)) ||
    allowed.some((key) => !(key in value))
  ) {
    throw new HostKeyReviewProtocolError('invalid');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
