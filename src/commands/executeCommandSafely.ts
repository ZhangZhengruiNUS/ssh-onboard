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
    await vscode.window.showErrorMessage(
      vscode.l10n.t('The operation could not be completed ({0}).', domainError.code),
    );
  }
}
