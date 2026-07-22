import { knownHostsAddress, type HostKeyObservation } from './hostKeys';
import type { ServerProfile, TrustedHostKey } from './profiles';

export type HostKeyTrustDecision =
  | { readonly kind: 'known'; readonly trusted: TrustedHostKey }
  | { readonly kind: 'first-use' }
  | { readonly kind: 'changed'; readonly previous: TrustedHostKey };

export function classifyHostKey(
  profile: ServerProfile,
  observation: HostKeyObservation,
): HostKeyTrustDecision {
  const existing = profile.trustedHostKey;
  if (existing === undefined) {
    return { kind: 'first-use' };
  }
  if (
    existing.algorithm === observation.algorithm &&
    existing.fingerprint === observation.fingerprint &&
    existing.keyBase64 === observation.keyBase64
  ) {
    return { kind: 'known', trusted: existing };
  }
  return { kind: 'changed', previous: existing };
}

export function trustObservedHostKey(
  profile: ServerProfile,
  observation: HostKeyObservation,
  trustedAt = new Date().toISOString(),
): TrustedHostKey {
  return {
    ...observation,
    knownHostsHost: knownHostsAddress(profile.host, profile.port),
    trustedAt,
  };
}
