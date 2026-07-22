import type { Client } from 'ssh2';

import { DomainError } from '../core/domainError';
import { isValidRemotePath } from '../domain/profiles';
import { execFixed } from './ssh2Utils';

const NUMERIC_ID_PATTERN = /^(?:0|[1-9][0-9]*)$/u;

export interface RemoteLayout {
  readonly home: string;
  readonly uid: number;
  readonly gid: number;
}

export class RemoteLayoutService {
  public async probe(client: Client): Promise<RemoteLayout> {
    const result = await execFixed(
      client,
      `printf '%s\\0%s\\0%s\\0' "$HOME" "$(id -u)" "$(id -g)"`,
    );
    return parseRemoteLayout(result);
  }
}

export function parseRemoteLayout(result: Buffer): RemoteLayout {
  const fields = result.toString('utf8').split('\0');
  const home = fields[0];
  const uidText = fields[1];
  const gidText = fields[2];
  if (
    fields.length !== 4 ||
    fields[3] !== '' ||
    home === undefined ||
    !isValidRemotePath(home) ||
    uidText === undefined ||
    !NUMERIC_ID_PATTERN.test(uidText) ||
    gidText === undefined ||
    !NUMERIC_ID_PATTERN.test(gidText)
  ) {
    throw new DomainError('REMOTE_LAYOUT_UNSAFE', 'layout-values');
  }
  const uid = Number(uidText);
  const gid = Number(gidText);
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid)) {
    throw new DomainError('REMOTE_LAYOUT_UNSAFE', 'layout-values');
  }
  if (uid === 0 && home !== '/root') {
    throw new DomainError('REMOTE_LAYOUT_UNSAFE', 'root-home');
  }
  return { home, uid, gid };
}
