import { randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import { DomainError, normalizeDomainError } from '../core/domainError';
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

    logger.error({ code: domainError.code, correlationId, stage });
    await vscode.window.showErrorMessage(errorMessage(domainError));
  }
}

function errorMessage(error: DomainError): string {
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
      return vscode.l10n.t(
        'SSH configuration changed or conflicts with a managed host. No conflicting file was overwritten.',
      );
    case 'PREREQUISITE_MISSING':
      return vscode.l10n.t('A required Windows OpenSSH tool or configuration is unavailable.');
    case 'PROFILE_NOT_FOUND':
      return vscode.l10n.t('The selected host profile no longer exists. Refresh the host list.');
    case 'REMOTE_LAYOUT_UNSAFE':
      return vscode.l10n.t(
        'The remote .ssh layout, ownership, or permissions are not safe for automatic modification.',
      );
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
