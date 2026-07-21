import type { Client } from 'ssh2';

import { DomainError } from '../core/domainError';
import { isValidRemotePath } from '../domain/profiles';
import { execFixed } from './ssh2Utils';

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
    const fields = result.toString('utf8').split('\0');
    const home = fields[0];
    const uid = Number(fields[1]);
    const gid = Number(fields[2]);
    if (
      home === undefined ||
      !isValidRemotePath(home) ||
      !Number.isInteger(uid) ||
      uid <= 0 ||
      !Number.isInteger(gid) ||
      gid < 0
    ) {
      throw new DomainError('REMOTE_LAYOUT_UNSAFE');
    }
    return { home, uid, gid };
  }
}
