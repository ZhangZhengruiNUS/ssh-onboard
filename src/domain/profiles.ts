import { isIP } from 'node:net';

import type { DomainErrorCode } from '../core/domainError';

export const PROFILE_SCHEMA_VERSION = 1 as const;

export type KeyStrategy =
  | { readonly kind: 'generated-per-host'; readonly keyId: string }
  | {
      readonly kind: 'existing';
      readonly privateKeyPath: string;
      readonly publicKeyPath?: string;
    }
  | { readonly kind: 'generated-per-group'; readonly groupId: string; readonly keyId: string };

export interface LocalKeyReference {
  readonly keyId: string;
  readonly privateKeyPath: string;
  readonly publicKeyPath?: string;
  readonly fingerprint: string;
  readonly publicKeyLine: string;
}

export interface TrustedHostKey {
  readonly algorithm: string;
  readonly fingerprint: string;
  readonly keyBase64: string;
  readonly knownHostsHost: string;
  readonly trustedAt: string;
}

export interface VerificationContext {
  readonly sshPath: string;
  readonly configFile: string;
  readonly keyFingerprint: string;
  readonly hostKeyFingerprint: string;
}

export type AuthorizationRecord =
  | {
      readonly ownership: 'managed';
      readonly fingerprint: string;
      readonly deploymentMarker: string;
      readonly deployedPublicKeyLine: string;
      readonly deployedAt: string;
    }
  | {
      readonly ownership: 'external';
      readonly fingerprint: string;
      readonly detectedAt: string;
    };

export interface ServerProfileV1 {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly alias: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly resolvedHome?: string;
  readonly defaultPath?: string;
  readonly group?: string;
  readonly platform: 'linux';
  readonly keyStrategy: KeyStrategy;
  readonly localKey?: LocalKeyReference;
  readonly trustedHostKey?: TrustedHostKey;
  readonly authorization?: AuthorizationRecord;
  readonly pendingAuthorization?: Extract<AuthorizationRecord, { readonly ownership: 'managed' }>;
  readonly lastVerifiedAt?: string;
  readonly verificationContext?: VerificationContext;
  readonly lastErrorCode?: DomainErrorCode;
}

export type ServerProfile = ServerProfileV1;

export interface ProfileDraft {
  readonly name: string;
  readonly alias: string;
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly defaultPath?: string;
  readonly group?: string;
  readonly keyStrategy: KeyStrategy;
}

export type ProfileStatus = 'setup-required' | 'host-trusted' | 'ready' | 'needs-attention';

const ALIAS_PATTERN = /^[A-Za-z0-9._-]+$/u;
const DNS_LABEL_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/u;
const USERNAME_PATTERN = /^[A-Za-z0-9._@-]+$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function validateProfileDraft(draft: ProfileDraft): readonly string[] {
  const errors: string[] = [];
  const name = draft.name.trim();
  const alias = draft.alias.trim();
  const host = draft.host.trim();
  const username = draft.username.trim();

  if (name.length === 0 || name.length > 100 || hasControl(name)) {
    errors.push('name');
  }
  if (
    alias.length === 0 ||
    alias.length > 64 ||
    alias.startsWith('-') ||
    !ALIAS_PATTERN.test(alias)
  ) {
    errors.push('alias');
  }
  if (!isValidHost(host)) {
    errors.push('host');
  }
  if (!Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65_535) {
    errors.push('port');
  }
  if (
    username.length === 0 ||
    username.length > 64 ||
    username.startsWith('-') ||
    !USERNAME_PATTERN.test(username)
  ) {
    errors.push('username');
  }
  if (draft.defaultPath !== undefined && !isValidRemotePath(draft.defaultPath)) {
    errors.push('defaultPath');
  }
  if (
    draft.group !== undefined &&
    (draft.group.trim().length === 0 || draft.group.length > 100 || hasControl(draft.group))
  ) {
    errors.push('group');
  }
  if (draft.keyStrategy.kind === 'generated-per-group' && draft.group === undefined) {
    errors.push('groupKey');
  }

  return errors;
}

export function isValidHost(host: string): boolean {
  if (
    host.length === 0 ||
    host.length > 253 ||
    host.startsWith('-') ||
    hasControl(host) ||
    /\s/u.test(host) ||
    host.startsWith('[') ||
    host.endsWith(']')
  ) {
    return false;
  }
  if (isIP(host) !== 0) {
    return true;
  }

  const candidate = host.endsWith('.') ? host.slice(0, -1) : host;
  return candidate.split('.').every((label) => DNS_LABEL_PATTERN.test(label));
}

export function isValidRemotePath(remotePath: string): boolean {
  return remotePath.startsWith('/') && remotePath.length <= 4096 && !hasControl(remotePath);
}

function hasControl(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || code === 0x7f;
  });
}

export function normalizeProfileDraft(draft: ProfileDraft): ProfileDraft {
  const defaultPath = draft.defaultPath?.trim();
  const group = draft.group?.trim();

  return {
    name: draft.name.trim(),
    alias: draft.alias.trim(),
    host: draft.host.trim(),
    port: draft.port,
    username: draft.username.trim(),
    ...(defaultPath === undefined || defaultPath.length === 0 ? {} : { defaultPath }),
    ...(group === undefined || group.length === 0 ? {} : { group }),
    keyStrategy: draft.keyStrategy,
  };
}

export function getProfileStatus(profile: ServerProfile): ProfileStatus {
  if (profile.lastErrorCode !== undefined) {
    return 'needs-attention';
  }
  const verificationMatches =
    profile.verificationContext !== undefined &&
    profile.localKey !== undefined &&
    profile.trustedHostKey !== undefined &&
    profile.verificationContext.keyFingerprint === profile.localKey.fingerprint &&
    profile.verificationContext.hostKeyFingerprint === profile.trustedHostKey.fingerprint &&
    profile.authorization?.fingerprint === profile.localKey.fingerprint;
  if (profile.lastVerifiedAt !== undefined && verificationMatches) {
    return 'ready';
  }
  if (profile.lastVerifiedAt !== undefined || profile.verificationContext !== undefined) {
    return 'needs-attention';
  }
  if (profile.trustedHostKey !== undefined) {
    return 'host-trusted';
  }
  return 'setup-required';
}

export function isServerProfile(value: unknown): value is ServerProfile {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const profile = value as Partial<ServerProfile>;
  return (
    profile.schemaVersion === PROFILE_SCHEMA_VERSION &&
    typeof profile.id === 'string' &&
    typeof profile.name === 'string' &&
    typeof profile.alias === 'string' &&
    typeof profile.host === 'string' &&
    typeof profile.port === 'number' &&
    typeof profile.username === 'string' &&
    profile.platform === 'linux' &&
    isKeyStrategy(profile.keyStrategy) &&
    isOptionalLocalKey(profile.localKey) &&
    isOptionalTrustedHostKey(profile.trustedHostKey) &&
    isOptionalAuthorization(profile.authorization) &&
    isOptionalManagedAuthorization(profile.pendingAuthorization) &&
    isOptionalVerificationContext(profile.verificationContext)
  );
}

function isOptionalManagedAuthorization(value: unknown): boolean {
  return (
    value === undefined ||
    (isOptionalAuthorization(value) && (value as AuthorizationRecord).ownership === 'managed')
  );
}

function isOptionalVerificationContext(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const context = value as Partial<VerificationContext>;
  return (
    typeof context.sshPath === 'string' &&
    typeof context.configFile === 'string' &&
    typeof context.keyFingerprint === 'string' &&
    typeof context.hostKeyFingerprint === 'string'
  );
}

function isKeyStrategy(value: unknown): value is KeyStrategy {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const strategy = value as Partial<KeyStrategy>;
  if (strategy.kind === 'generated-per-host') {
    return typeof strategy.keyId === 'string' && UUID_PATTERN.test(strategy.keyId);
  }
  if (strategy.kind === 'generated-per-group') {
    return (
      typeof strategy.groupId === 'string' &&
      strategy.groupId.length > 0 &&
      typeof strategy.keyId === 'string' &&
      UUID_PATTERN.test(strategy.keyId)
    );
  }
  return strategy.kind === 'existing' && typeof strategy.privateKeyPath === 'string';
}

function isOptionalLocalKey(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const key = value as Partial<LocalKeyReference>;
  return (
    typeof key.keyId === 'string' &&
    typeof key.privateKeyPath === 'string' &&
    typeof key.fingerprint === 'string' &&
    typeof key.publicKeyLine === 'string'
  );
}

function isOptionalTrustedHostKey(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const trust = value as Partial<TrustedHostKey>;
  return (
    typeof trust.algorithm === 'string' &&
    typeof trust.fingerprint === 'string' &&
    typeof trust.keyBase64 === 'string' &&
    typeof trust.knownHostsHost === 'string' &&
    typeof trust.trustedAt === 'string'
  );
}

function isOptionalAuthorization(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const authorization = value as Partial<AuthorizationRecord>;
  if (authorization.ownership === 'external' && typeof authorization.fingerprint === 'string') {
    return typeof authorization.detectedAt === 'string';
  }
  return (
    authorization.ownership === 'managed' &&
    typeof authorization.fingerprint === 'string' &&
    typeof authorization.deploymentMarker === 'string' &&
    typeof authorization.deployedPublicKeyLine === 'string' &&
    typeof authorization.deployedAt === 'string'
  );
}
