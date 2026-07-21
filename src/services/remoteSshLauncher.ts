import * as vscode from 'vscode';

import { DomainError } from '../core/domainError';
import type { ServerProfile } from '../domain/profiles';

const REMOTE_SSH_EXTENSION_ID = 'ms-vscode-remote.remote-ssh';

export class RemoteSshLauncher {
  public async open(profile: ServerProfile): Promise<void> {
    const remoteSsh = vscode.extensions.getExtension(REMOTE_SSH_EXTENSION_ID);
    if (remoteSsh === undefined) {
      throw new DomainError('REMOTE_SSH_UNAVAILABLE');
    }
    const remotePath = profile.defaultPath ?? profile.resolvedHome;
    if (remotePath === undefined) {
      throw new DomainError('DEFAULT_PATH_INVALID');
    }
    const uri = vscode.Uri.from({
      scheme: 'vscode-remote',
      authority: `ssh-remote+${profile.alias}`,
      path: remotePath,
    });
    const opened = await vscode.commands.executeCommand<boolean>('vscode.openFolder', uri, {
      forceNewWindow: true,
    });
    if (opened === false) {
      throw new DomainError('REMOTE_SSH_LAUNCH_FAILED');
    }
  }
}
