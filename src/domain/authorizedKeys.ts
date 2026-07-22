import { DomainError } from '../core/domainError';
import { parsePublicKeyLine } from './keys';
import type { AuthorizationRecord } from './profiles';

export interface AuthorizedKeyAppendResult {
  readonly content: Buffer;
  readonly deploymentMarker?: string;
  readonly deployedPublicKeyLine?: string;
  readonly alreadyPresent: boolean;
}

export function appendAuthorizedKey(
  source: Buffer,
  plan: Extract<AuthorizationRecord, { readonly ownership: 'managed' }>,
): AuthorizedKeyAppendResult {
  const targetKey = parsePublicKeyLine(plan.deployedPublicKeyLine);
  const fingerprintMatches: string[] = [];
  for (const lineBytes of splitBufferLines(source)) {
    const line = lineBytes.toString('utf8');
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) {
      continue;
    }
    try {
      if (parsePublicKeyLine(line).fingerprint === targetKey.fingerprint) {
        fingerprintMatches.push(line.trim());
      }
    } catch {
      // Preserve malformed and unsupported lines without treating them as the target key.
    }
  }

  if (fingerprintMatches.length > 1) {
    throw new DomainError('AUTHORIZED_KEYS_WRITE_FAILED', 'ambiguous-fingerprint');
  }
  const existing = fingerprintMatches[0];
  if (existing !== undefined) {
    if (existing === plan.deployedPublicKeyLine && existing.endsWith(plan.deploymentMarker)) {
      return {
        content: source,
        alreadyPresent: false,
        deploymentMarker: plan.deploymentMarker,
        deployedPublicKeyLine: plan.deployedPublicKeyLine,
      };
    }
    return { content: source, alreadyPresent: true };
  }

  const separator = source.length === 0 || source[source.length - 1] === 0x0a ? '' : '\n';
  return {
    content: Buffer.concat([
      source,
      Buffer.from(`${separator}${plan.deployedPublicKeyLine}\n`, 'utf8'),
    ]),
    deploymentMarker: plan.deploymentMarker,
    deployedPublicKeyLine: plan.deployedPublicKeyLine,
    alreadyPresent: false,
  };
}

export function createDeploymentPlan(
  publicKeyLine: string,
  profileId: string,
  deploymentId: string,
): Extract<AuthorizationRecord, { readonly ownership: 'managed' }> {
  const key = parsePublicKeyLine(publicKeyLine);
  const deploymentMarker = `ssh-onboard:${profileId}:${deploymentId}`;
  return {
    ownership: 'managed',
    fingerprint: key.fingerprint,
    deploymentMarker,
    deployedPublicKeyLine: `${key.algorithm} ${key.keyBase64} ${deploymentMarker}`,
    deployedAt: new Date().toISOString(),
  };
}

export function revokeAuthorizedKey(
  source: Buffer,
  expectedLine: string,
  expectedMarker: string,
  expectedFingerprint: string,
): { readonly content: Buffer; readonly removed: boolean } {
  const lines = splitBufferLinesWithEndings(source);
  const expected = Buffer.from(expectedLine, 'utf8');
  const fingerprintMatches = lines.filter((line) => {
    const withoutEnding = removeLineEnding(line);
    try {
      const decoded = withoutEnding.toString('utf8');
      return parsePublicKeyLine(decoded).fingerprint === expectedFingerprint;
    } catch {
      return false;
    }
  });
  const matches = fingerprintMatches.filter((line) => {
    const withoutEnding = removeLineEnding(line);
    return (
      withoutEnding.equals(expected) && withoutEnding.toString('utf8').endsWith(expectedMarker)
    );
  });
  if (fingerprintMatches.length === 0) {
    return { content: source, removed: false };
  }
  if (matches.length !== 1 || fingerprintMatches.length !== 1) {
    throw new DomainError('AUTHORIZED_KEYS_WRITE_FAILED', 'ambiguous-fingerprint');
  }
  let removed = false;
  const next = lines.filter((line) => {
    if (!removed && line === matches[0]) {
      removed = true;
      return false;
    }
    return true;
  });
  return { content: Buffer.concat(next), removed: true };
}

function splitBufferLines(source: Buffer): readonly Buffer[] {
  return splitBufferLinesWithEndings(source).map((line) => removeLineEnding(line));
}

function splitBufferLinesWithEndings(source: Buffer): readonly Buffer[] {
  const lines: Buffer[] = [];
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === 0x0a) {
      lines.push(source.subarray(start, index + 1));
      start = index + 1;
    }
  }
  if (start < source.length) {
    lines.push(source.subarray(start));
  }
  return lines;
}

function removeLineEnding(line: Buffer): Buffer {
  let end = line.length;
  if (end > 0 && line[end - 1] === 0x0a) {
    end -= 1;
  }
  if (end > 0 && line[end - 1] === 0x0d) {
    end -= 1;
  }
  return line.subarray(0, end);
}
