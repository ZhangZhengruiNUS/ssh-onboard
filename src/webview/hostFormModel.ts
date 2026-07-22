import path from 'node:path';

import type { ServerProfile } from '../domain/profiles';
import type { HostFormDraftDto } from './hostFormProtocol';

export function profileToHostFormDraftDto(profile?: ServerProfile): HostFormDraftDto {
  if (profile === undefined) {
    return {
      name: '',
      host: '',
      port: 22,
      username: '',
      alias: '',
      keyStrategy: { kind: 'generated-per-host' },
    };
  }
  return {
    name: profile.name,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    alias: profile.alias,
    ...(profile.defaultPath === undefined ? {} : { defaultPath: profile.defaultPath }),
    ...(profile.group === undefined ? {} : { group: profile.group }),
    keyStrategy:
      profile.keyStrategy.kind === 'existing'
        ? {
            kind: 'existing',
            selectionLabel: path.win32.basename(profile.keyStrategy.privateKeyPath),
          }
        : { kind: profile.keyStrategy.kind },
  };
}
