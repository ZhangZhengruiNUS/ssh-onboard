import * as vscode from 'vscode';

import { executeCommandSafely } from './commands/executeCommandSafely';
import {
  connectHost,
  initializeHost,
  revokeKey,
  testKeyConnection,
  type HostCommandServices,
} from './commands/hostCommands';
import {
  addHost,
  editHost,
  exportProfiles,
  removeHost,
  searchHosts,
  showDiagnostics,
} from './commands/profileCommands';
import { ExtensionLogger } from './logging/extensionLogger';
import { WindowsFileAcl } from './platform/windows/fileAcl';
import { WindowsOpenSsh } from './platform/windows/openssh';
import { ProcessRunner } from './platform/windows/processRunner';
import { AuthorizedKeysService } from './services/authorizedKeysService';
import { BootstrapClient } from './services/bootstrapClient';
import { KeyManager } from './services/keyManager';
import { ProfileStore } from './services/profileStore';
import { readRemoteSshSettings } from './services/remoteSettings';
import { RemoteLayoutService } from './services/remoteLayoutService';
import { RemoteSshLauncher } from './services/remoteSshLauncher';
import { SshConfigService } from './services/sshConfigService';
import { VerificationService } from './services/verificationService';
import { HostTreeDataProvider, type HostTreeItem } from './views/hostTreeDataProvider';

const REMOTE_SSH_EXTENSION_ID = 'ms-vscode-remote.remote-ssh';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel(vscode.l10n.t('SSH Onboard'), { log: true });
  const logger = new ExtensionLogger(output);
  const profiles = new ProfileStore(context.globalState, context.globalStorageUri.fsPath);
  const packageManifest = context.extension.packageJSON as { readonly version?: unknown };
  const extensionVersion =
    typeof packageManifest.version === 'string' ? packageManifest.version : 'unknown';
  const tree = new HostTreeDataProvider(profiles);
  const runner = new ProcessRunner();
  const acl = new WindowsFileAcl(runner);
  const services: HostCommandServices = {
    profiles,
    tree,
    openssh: new WindowsOpenSsh(runner),
    keys: new KeyManager(runner, acl),
    bootstrap: new BootstrapClient(),
    remoteLayout: new RemoteLayoutService(),
    authorizedKeys: new AuthorizedKeysService(),
    sshConfig: new SshConfigService(runner, acl),
    verification: new VerificationService(runner),
    launcher: new RemoteSshLauncher(),
  };

  const command = (
    id: string,
    stage: Parameters<typeof executeCommandSafely>[1],
    handler: (item?: HostTreeItem) => Promise<void>,
  ): vscode.Disposable =>
    vscode.commands.registerCommand(id, (item?: HostTreeItem) =>
      executeCommandSafely(logger, stage, () => handler(item)),
    );

  context.subscriptions.push(
    output,
    vscode.window.registerTreeDataProvider('sshOnboard.servers', tree),
    vscode.commands.registerCommand('sshOnboard.showLogs', () => logger.show()),
    vscode.commands.registerCommand('sshOnboard.refresh', () => tree.refresh()),
    command('sshOnboard.addHost', 'add-host', () => addHost(profiles, tree)),
    command('sshOnboard.editHost', 'edit-host', (item) =>
      editHost(item, profiles, tree, async (updatedProfiles) => {
        const settings = readRemoteSshSettings();
        await services.sshConfig.synchronize(
          updatedProfiles,
          services.sshConfig.resolvePaths(settings.configFile),
        );
      }),
    ),
    command('sshOnboard.removeHost', 'remove-host', (item) =>
      removeHost(item, profiles, tree, async (remaining) => {
        const settings = readRemoteSshSettings();
        await services.sshConfig.synchronize(
          remaining,
          services.sshConfig.resolvePaths(settings.configFile),
        );
      }),
    ),
    command('sshOnboard.initializeHost', 'initialize-host', (item) =>
      initializeHost(item, services),
    ),
    command('sshOnboard.testConnection', 'test-connection', (item) =>
      testKeyConnection(item, services),
    ),
    command('sshOnboard.connectHost', 'connect-host', (item) => connectHost(item, services)),
    command('sshOnboard.revokeKey', 'revoke-key', (item) => revokeKey(item, services)),
    command('sshOnboard.showDiagnostics', 'show-diagnostics', (item) =>
      showDiagnostics(item, profiles, extensionVersion),
    ),
    command('sshOnboard.exportProfiles', 'export-profiles', () => exportProfiles(profiles)),
    command('sshOnboard.searchHosts', 'search-hosts', async () => {
      const selected = await searchHosts(profiles);
      if (selected !== undefined) {
        await connectHost(selected, services);
      }
    }),
  );

  const remoteSshAvailable = vscode.extensions.getExtension(REMOTE_SSH_EXTENSION_ID) !== undefined;
  void vscode.commands
    .executeCommand('setContext', 'sshOnboard.remoteSshAvailable', remoteSshAvailable)
    .then(
      () => logger.info({ stage: 'remote-ssh-detection' }),
      () => logger.error({ code: 'UNEXPECTED', stage: 'remote-ssh-detection' }),
    );
  logger.info({ stage: 'activation' });
}

export function deactivate(): void {}
