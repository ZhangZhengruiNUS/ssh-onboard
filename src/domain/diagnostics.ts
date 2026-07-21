import path from 'node:path';

import { getProfileStatus, type ServerProfile } from './profiles';

export interface DiagnosticRuntime {
  readonly platform: string;
  readonly architecture: string;
  readonly vscodeVersion: string;
  readonly remoteSshInstalled: boolean;
  readonly remoteSshActive: boolean;
}

export function createDiagnosticReport(
  profile: ServerProfile,
  extensionVersion: string,
  runtime: DiagnosticRuntime,
  generatedAt = new Date().toISOString(),
): object {
  const configuredPath = profile.defaultPath ?? profile.resolvedHome;
  return {
    reportVersion: 1,
    generatedAt,
    extensionVersion,
    runtime,
    host: {
      status: getProfileStatus(profile),
      defaultPathLeaf:
        configuredPath === undefined ? undefined : path.posix.basename(configuredPath),
      keyStrategy: profile.keyStrategy.kind,
      authorizationOwnership: profile.authorization?.ownership,
      keyFingerprint: profile.localKey?.fingerprint,
      hostKeyFingerprint: profile.trustedHostKey?.fingerprint,
      lastVerifiedAt: profile.lastVerifiedAt,
      lastErrorCode: profile.lastErrorCode,
    },
  };
}
