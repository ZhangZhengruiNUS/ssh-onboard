import { randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import { configConflictReason, type ConfigConflictReason } from '../core/configConflict';
import { DomainError, normalizeDomainError } from '../core/domainError';
import { remoteLayoutReason, type RemoteLayoutReason } from '../core/remoteLayoutIssue';
import type { ExtensionLogger } from '../logging/extensionLogger';
import type { SafeLogStage } from '../logging/safeLog';

export async function executeCommandSafely(
  logger: ExtensionLogger,
  stage: SafeLogStage,
  operation: () => Promise<void>,
): Promise<void> {
  const correlationId = randomUUID();

  try {
    await operation();
  } catch (error: unknown) {
    const domainError =
      error instanceof vscode.CancellationError
        ? new DomainError('CANCELLED')
        : normalizeDomainError(error);

    if (domainError.code === 'CANCELLED') {
      logger.info({ code: domainError.code, correlationId, stage });
      return;
    }

    const configReason =
      domainError.code === 'LOCAL_CONFIG_CONFLICT'
        ? configConflictReason(domainError.detail)
        : undefined;
    const layoutReason =
      domainError.code === 'REMOTE_LAYOUT_UNSAFE'
        ? remoteLayoutReason(domainError.detail)
        : undefined;
    const reason = configReason ?? layoutReason;
    logger.error({
      code: domainError.code,
      correlationId,
      ...(reason === undefined ? {} : { reason }),
      stage,
    });
    const action = await vscode.window.showErrorMessage(
      errorMessage(domainError, configReason, layoutReason),
      ...errorActions(configReason),
    );
    if (action === vscode.l10n.t('Open Remote - SSH Settings')) {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'remote.SSH');
    } else if (action === vscode.l10n.t('Open SSH Config')) {
      await vscode.commands.executeCommand('sshOnboard.openSshConfig');
    } else if (action === vscode.l10n.t('Show SSH Onboard Logs')) {
      logger.show();
    }
  }
}

function errorMessage(
  error: DomainError,
  configReason?: ConfigConflictReason,
  layoutReason?: RemoteLayoutReason,
): string {
  switch (error.code) {
    case 'AUTH_FAILED':
      return vscode.l10n.t(
        'Authentication failed. No password was saved and no automatic retry was attempted.',
      );
    case 'AUTHORIZED_KEYS_LOCKED':
      return vscode.l10n.t(
        'Another SSH Onboard operation is updating authorized_keys. Try again later.',
      );
    case 'AUTHORIZED_KEYS_WRITE_FAILED':
      return vscode.l10n.t(
        'authorized_keys could not be updated safely. Existing entries were not intentionally removed.',
      );
    case 'DEFAULT_PATH_INVALID':
      return vscode.l10n.t(
        'The default remote folder does not exist or cannot be entered. Edit the host and try again.',
      );
    case 'HOST_KEY_CHANGED':
      return vscode.l10n.t(
        'The SSH host key changed. The connection was blocked before authentication.',
      );
    case 'HOST_KEY_UNTRUSTED':
      return vscode.l10n.t(
        'The SSH host key was not trusted. The connection was stopped before authentication.',
      );
    case 'INVALID_PROFILE':
      return vscode.l10n.t('The host profile is invalid or its stored schema is unsupported.');
    case 'KEY_GENERATION_FAILED':
      return vscode.l10n.t(
        'The SSH key could not be prepared or its private-key permissions are unsafe.',
      );
    case 'KEY_VERIFICATION_FAILED':
      return vscode.l10n.t(
        'The exact configured key could not complete a non-interactive SSH login.',
      );
    case 'LOCAL_CONFIG_CONFLICT':
      return configConflictMessage(configReason ?? 'unknown');
    case 'PREREQUISITE_MISSING':
      return vscode.l10n.t('A required Windows OpenSSH tool or configuration is unavailable.');
    case 'PROFILE_NOT_FOUND':
      return vscode.l10n.t('The selected host profile no longer exists. Refresh the host list.');
    case 'REMOTE_LAYOUT_UNSAFE':
      return remoteLayoutMessage(layoutReason ?? 'unknown');
    case 'REMOTE_SSH_LAUNCH_FAILED':
      return vscode.l10n.t(
        'Remote - SSH could not open the configured folder. The SSH configuration was kept.',
      );
    case 'REMOTE_SSH_UNAVAILABLE':
      return vscode.l10n.t(
        'Install or enable Microsoft Remote - SSH before opening the remote folder.',
      );
    case 'UNSUPPORTED_PLATFORM':
      return vscode.l10n.t('SSH Onboard V0.1 supports local Windows hosts only.');
    default:
      return vscode.l10n.t('The operation could not be completed ({0}).', error.code);
  }
}

function remoteLayoutMessage(reason: RemoteLayoutReason): string {
  switch (reason) {
    case 'layout-values':
    case 'probe-failed':
    case 'probe-output-limit':
      return vscode.l10n.t(
        'The server did not provide a valid Linux home directory and user identity. No remote file was changed.',
      );
    case 'sftp-unavailable':
      return vscode.l10n.t(
        'The server did not provide the SFTP subsystem required for safe key installation. No remote file was changed.',
      );
    case 'root-home':
      return vscode.l10n.t(
        'The root account did not report the standard /root home directory. SSH Onboard stopped before changing remote files.',
      );
    case 'sftp-read-failed':
    case 'sftp-stat-failed':
      return vscode.l10n.t(
        'SSH Onboard could not safely inspect the remote SSH files. Check account access and inspect authorized_keys before retrying.',
      );
    case 'ssh-directory-create-failed':
      return vscode.l10n.t(
        'The account cannot create its .ssh directory. Check the home-directory permissions and try again.',
      );
    case 'ssh-directory-missing':
    case 'ssh-directory-type':
      return vscode.l10n.t(
        'The remote .ssh path is not a supported directory. Nothing was overwritten.',
      );
    case 'ssh-directory-owner':
      return vscode.l10n.t(
        'The remote .ssh directory is not owned by the login account. Nothing was changed.',
      );
    case 'ssh-directory-permissions':
      return vscode.l10n.t(
        'The remote .ssh directory is writable by another account or not writable by its owner. Fix its permissions before retrying.',
      );
    case 'authorized-keys-type':
      return vscode.l10n.t(
        'The remote authorized_keys path is a link or non-regular file. SSH Onboard stopped; inspect it before retrying.',
      );
    case 'authorized-keys-owner':
      return vscode.l10n.t(
        'The remote authorized_keys file is not owned by the login account. SSH Onboard stopped; inspect it before retrying.',
      );
    case 'authorized-keys-size':
      return vscode.l10n.t(
        'The remote authorized_keys file is unexpectedly large. SSH Onboard stopped; inspect it before retrying.',
      );
    case 'authorized-keys-permissions':
      return vscode.l10n.t(
        'The remote authorized_keys file is writable by another account or unreadable by its owner. Fix its permissions before retrying.',
      );
    case 'unknown':
      return vscode.l10n.t(
        'The remote .ssh layout, ownership, or permissions are not safe for automatic modification.',
      );
  }
}

function configConflictMessage(reason: ConfigConflictReason): string {
  switch (reason) {
    case 'alias-in-use':
      return vscode.l10n.t(
        'This SSH alias is already defined. Choose a different alias; the existing Host block was not changed.',
      );
    case 'authorization-requires-revoke':
      return vscode.l10n.t(
        'Revoke the SSH Onboard managed key before changing or removing this host.',
      );
    case 'remote-setting-workspace':
      return vscode.l10n.t(
        'Remote - SSH path or configFile is set at Workspace scope. Move it to User settings before continuing.',
      );
    case 'remote-setting-invalid':
      return vscode.l10n.t(
        'A Remote - SSH path or configFile setting is empty or invalid. Review User settings before continuing.',
      );
    case 'include-conflict':
      return vscode.l10n.t(
        'The SSH config contains a conflicting SSH Onboard Include directive. No config file was changed.',
      );
    case 'managed-file-external-change':
      return vscode.l10n.t(
        'An SSH Onboard managed file changed outside the extension. Review it before retrying; nothing was overwritten.',
      );
    case 'managed-state-invalid':
      return vscode.l10n.t(
        'SSH Onboard managed state is damaged or unsupported. Nothing was overwritten.',
      );
    case 'lock-busy':
      return vscode.l10n.t(
        'Another SSH Onboard operation is still running, or a previous operation left a lock. Try again after it finishes.',
      );
    case 'concurrent-change':
      return vscode.l10n.t(
        'SSH configuration changed while this operation was running. Review the latest file and retry.',
      );
    case 'unsafe-config-file':
      return vscode.l10n.t(
        'An SSH configuration path is not a supported regular UTF-8 file. Nothing was changed.',
      );
    case 'config-verification-failed':
      return vscode.l10n.t(
        'Windows OpenSSH did not resolve the managed host exactly as expected. Review the SSH config before retrying.',
      );
    case 'unknown':
      return vscode.l10n.t(
        'SSH configuration changed or conflicts with a managed host. No conflicting file was overwritten.',
      );
  }
}

function errorActions(reason: ConfigConflictReason | undefined): string[] {
  if (reason === 'remote-setting-workspace' || reason === 'remote-setting-invalid') {
    return [vscode.l10n.t('Open Remote - SSH Settings'), vscode.l10n.t('Show SSH Onboard Logs')];
  }
  if (
    reason === 'alias-in-use' ||
    reason === 'include-conflict' ||
    reason === 'managed-file-external-change' ||
    reason === 'managed-state-invalid' ||
    reason === 'concurrent-change' ||
    reason === 'unsafe-config-file' ||
    reason === 'config-verification-failed'
  ) {
    return [vscode.l10n.t('Open SSH Config'), vscode.l10n.t('Show SSH Onboard Logs')];
  }
  return [vscode.l10n.t('Show SSH Onboard Logs')];
}
