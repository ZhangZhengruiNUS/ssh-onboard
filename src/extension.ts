import * as vscode from 'vscode';

import { executeCommandSafely } from './commands/executeCommandSafely';
import { DomainError } from './core/domainError';
import { ExtensionLogger } from './logging/extensionLogger';
import { HostTreeDataProvider } from './views/hostTreeDataProvider';

const REMOTE_SSH_EXTENSION_ID = 'ms-vscode-remote.remote-ssh';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(vscode.l10n.t('SSH Onboard'), { log: true });
  const logger = new ExtensionLogger(output);
  const hostTreeDataProvider = new HostTreeDataProvider();

  context.subscriptions.push(
    output,
    vscode.window.registerTreeDataProvider('sshOnboard.servers', hostTreeDataProvider),
    vscode.commands.registerCommand('sshOnboard.showLogs', () => {
      logger.show();
    }),
    vscode.commands.registerCommand('sshOnboard.addHost', () =>
      executeCommandSafely(logger, 'add-host', async () => {
        if (process.platform !== 'win32') {
          throw new DomainError('UNSUPPORTED_PLATFORM');
        }

        await vscode.window.showInformationMessage(
          vscode.l10n.t('Host onboarding will be implemented in the next development phase.'),
        );
      }),
    ),
  );

  const remoteSshAvailable = vscode.extensions.getExtension(REMOTE_SSH_EXTENSION_ID) !== undefined;
  void vscode.commands
    .executeCommand('setContext', 'sshOnboard.remoteSshAvailable', remoteSshAvailable)
    .then(
      () => {
        logger.info({ stage: 'remote-ssh-detection' });
      },
      () => {
        logger.error({ code: 'UNEXPECTED', stage: 'remote-ssh-detection' });
      },
    );

  logger.info({ stage: 'activation' });
}

export function deactivate(): void {}
