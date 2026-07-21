import { createHash } from 'node:crypto';

import { DomainError } from '../core/domainError';

const PUBLIC_KEY_TYPES = new Set([
  'ssh-ed25519',
  'ssh-rsa',
  'sk-ssh-ed25519@openssh.com',
  'sk-ecdsa-sha2-nistp256@openssh.com',
]);

export interface ParsedPublicKey {
  readonly algorithm: string;
  readonly keyBase64: string;
  readonly fingerprint: string;
}

export function parsePublicKeyLine(line: string): ParsedPublicKey {
  if (line.length > 16_384) {
    throw new DomainError('KEY_GENERATION_FAILED', 'public-key-size');
  }
  const tokens = line.trim().split(/\s+/u);
  const algorithmIndex = tokens.findIndex(
    (token) => PUBLIC_KEY_TYPES.has(token) || token.startsWith('ecdsa-sha2-'),
  );
  const algorithm = tokens[algorithmIndex];
  const keyBase64 = tokens[algorithmIndex + 1];
  if (algorithmIndex < 0 || algorithm === undefined || keyBase64 === undefined) {
    throw new DomainError('KEY_GENERATION_FAILED', 'public-key-format');
  }
  let blob: Buffer;
  try {
    blob = Buffer.from(keyBase64, 'base64');
  } catch {
    throw new DomainError('KEY_GENERATION_FAILED', 'public-key-base64');
  }
  if (
    blob.length === 0 ||
    blob.toString('base64').replace(/=+$/u, '') !== keyBase64.replace(/=+$/u, '')
  ) {
    throw new DomainError('KEY_GENERATION_FAILED', 'public-key-base64');
  }
  if (readSshString(blob) !== algorithm) {
    throw new DomainError('KEY_GENERATION_FAILED', 'public-key-algorithm');
  }
  return {
    algorithm,
    keyBase64,
    fingerprint: fingerprintBlob(blob),
  };
}

function readSshString(blob: Buffer): string {
  if (blob.length < 5) {
    throw new DomainError('KEY_GENERATION_FAILED', 'public-key-blob');
  }
  const length = blob.readUInt32BE(0);
  if (length < 1 || length > blob.length - 4) {
    throw new DomainError('KEY_GENERATION_FAILED', 'public-key-blob');
  }
  return blob.subarray(4, 4 + length).toString('ascii');
}

export function fingerprintBlob(blob: Buffer): string {
  return `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/u, '')}`;
}

export function canonicalPublicKeyLine(line: string, comment: string): string {
  const parsed = parsePublicKeyLine(line);
  return `${parsed.algorithm} ${parsed.keyBase64} ${comment}`;
}
