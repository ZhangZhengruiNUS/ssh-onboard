export const MAX_HOST_FORM_MESSAGE_BYTES = 64 * 1024;

export type HostFormField =
  'name' | 'host' | 'port' | 'username' | 'alias' | 'defaultPath' | 'group' | 'keyStrategy';

export type HostFormKeyStrategyDto =
  | { readonly kind: 'generated-per-host' }
  | {
      readonly kind: 'existing';
      readonly selectionLabel?: string;
      readonly selectionToken?: string;
    }
  | { readonly kind: 'generated-per-group' };

export interface HostFormDraftDto {
  readonly name: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly alias: string;
  readonly defaultPath?: string;
  readonly group?: string;
  readonly keyStrategy: HostFormKeyStrategyDto;
}

export type HostFormSaveIntent = 'save-only' | 'save-and-initialize';

export type HostFormToExtensionMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'dirty'; readonly revision: string; readonly dirty: boolean }
  | {
      readonly type: 'validate';
      readonly revision: string;
      readonly sequence: number;
      readonly draft: HostFormDraftDto;
    }
  | {
      readonly type: 'save';
      readonly revision: string;
      readonly intent: HostFormSaveIntent;
      readonly draft: HostFormDraftDto;
    }
  | { readonly type: 'pickExistingKey'; readonly revision: string }
  | { readonly type: 'cancel'; readonly revision: string };

export type ExtensionToHostFormMessage =
  | {
      readonly type: 'initialize';
      readonly mode: 'add' | 'edit';
      readonly revision: string;
      readonly draft: HostFormDraftDto;
    }
  | {
      readonly type: 'validation';
      readonly revision: string;
      readonly sequence: number;
      readonly errors: Partial<Record<HostFormField, string>>;
      readonly suggestedAlias?: string;
    }
  | {
      readonly type: 'existingKeySelected';
      readonly revision: string;
      readonly selectionLabel: string;
      readonly selectionToken: string;
    }
  | { readonly type: 'operationError'; readonly revision: string; readonly message: string };

export class HostFormProtocolError extends Error {
  public constructor(public readonly reason: 'invalid' | 'oversize') {
    super(`Host form message rejected: ${reason}`);
    this.name = 'HostFormProtocolError';
  }
}

export function parseHostFormMessage(value: unknown): HostFormToExtensionMessage {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new HostFormProtocolError('invalid');
  }
  if (encoded === undefined) {
    throw new HostFormProtocolError('invalid');
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_HOST_FORM_MESSAGE_BYTES) {
    throw new HostFormProtocolError('oversize');
  }
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new HostFormProtocolError('invalid');
  }
  switch (value.type) {
    case 'ready':
      assertExactKeys(value, ['type']);
      return { type: 'ready' };
    case 'dirty':
      assertExactKeys(value, ['type', 'revision', 'dirty']);
      return {
        type: 'dirty',
        revision: requiredRevision(value.revision),
        dirty: requiredBoolean(value.dirty),
      };
    case 'validate':
      assertExactKeys(value, ['type', 'revision', 'sequence', 'draft']);
      return {
        type: 'validate',
        revision: requiredRevision(value.revision),
        sequence: requiredSequence(value.sequence),
        draft: parseDraft(value.draft),
      };
    case 'save':
      assertExactKeys(value, ['type', 'revision', 'intent', 'draft']);
      return {
        type: 'save',
        revision: requiredRevision(value.revision),
        intent: requiredSaveIntent(value.intent),
        draft: parseDraft(value.draft),
      };
    case 'pickExistingKey':
    case 'cancel':
      assertExactKeys(value, ['type', 'revision']);
      return { type: value.type, revision: requiredRevision(value.revision) };
    default:
      throw new HostFormProtocolError('invalid');
  }
}

function requiredSaveIntent(value: unknown): HostFormSaveIntent {
  if (value !== 'save-only' && value !== 'save-and-initialize') {
    throw new HostFormProtocolError('invalid');
  }
  return value;
}

export function assertHostFormDtoSafe(value: HostFormDraftDto): void {
  const forbidden = new Set([
    'privateKeyPath',
    'publicKeyPath',
    'publicKeyLine',
    'keyBase64',
    'fingerprint',
    'deploymentMarker',
    'authorization',
    'pendingAuthorization',
    'password',
  ]);
  const visit = (candidate: unknown): void => {
    if (!isRecord(candidate)) {
      return;
    }
    for (const [key, nested] of Object.entries(candidate)) {
      if (forbidden.has(key)) {
        throw new HostFormProtocolError('invalid');
      }
      visit(nested);
    }
  };
  visit(value);
}

function parseDraft(value: unknown): HostFormDraftDto {
  if (!isRecord(value)) {
    throw new HostFormProtocolError('invalid');
  }
  assertExactKeys(value, [
    'name',
    'host',
    'port',
    'username',
    'alias',
    'defaultPath',
    'group',
    'keyStrategy',
  ]);
  const result: HostFormDraftDto = {
    name: requiredString(value.name, 100),
    host: requiredString(value.host, 253),
    port: requiredNumber(value.port),
    username: requiredString(value.username, 64),
    alias: requiredString(value.alias, 64),
    ...optionalStringProperty(value, 'defaultPath', 4096),
    ...optionalStringProperty(value, 'group', 100),
    keyStrategy: parseKeyStrategy(value.keyStrategy),
  };
  assertHostFormDtoSafe(result);
  return result;
}

function parseKeyStrategy(value: unknown): HostFormKeyStrategyDto {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new HostFormProtocolError('invalid');
  }
  if (value.kind === 'generated-per-host' || value.kind === 'generated-per-group') {
    assertExactKeys(value, ['kind']);
    return { kind: value.kind };
  }
  if (value.kind === 'existing') {
    assertExactKeys(value, ['kind', 'selectionLabel', 'selectionToken']);
    return {
      kind: 'existing',
      ...optionalStringProperty(value, 'selectionLabel', 128),
      ...optionalStringProperty(value, 'selectionToken', 128),
    };
  }
  throw new HostFormProtocolError('invalid');
}

function optionalStringProperty<
  T extends 'defaultPath' | 'group' | 'selectionLabel' | 'selectionToken',
>(value: Record<string, unknown>, key: T, maximumLength: number): Partial<Record<T, string>> {
  const candidate = value[key];
  if (candidate === undefined) {
    return {};
  }
  return { [key]: requiredString(candidate, maximumLength) } as Partial<Record<T, string>>;
}

function requiredString(value: unknown, maximumLength: number): string {
  if (typeof value !== 'string' || value.length > maximumLength) {
    throw new HostFormProtocolError('invalid');
  }
  return value;
}

function requiredRevision(value: unknown): string {
  const revision = requiredString(value, 128);
  if (!/^[0-9a-f-]{36}$/iu.test(revision)) {
    throw new HostFormProtocolError('invalid');
  }
  return revision;
}

function requiredBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new HostFormProtocolError('invalid');
  }
  return value;
}

function requiredNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HostFormProtocolError('invalid');
  }
  return value;
}

function requiredSequence(value: unknown): number {
  const sequence = requiredNumber(value);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    throw new HostFormProtocolError('invalid');
  }
  return sequence;
}

function assertExactKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new HostFormProtocolError('invalid');
  }
  if (
    allowed
      .filter(
        (key) =>
          key !== 'defaultPath' &&
          key !== 'group' &&
          key !== 'selectionLabel' &&
          key !== 'selectionToken',
      )
      .some((key) => !(key in value))
  ) {
    throw new HostFormProtocolError('invalid');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
