import { randomUUID } from 'node:crypto';

import * as vscode from 'vscode';

import {
  validateProfileDraft,
  type KeyStrategy,
  type ProfileDraft,
  type ServerProfile,
} from '../domain/profiles';

export async function promptForProfile(
  current?: ServerProfile,
  groupKeyId?: (group: string) => string | undefined,
): Promise<ProfileDraft> {
  const name = await requiredInput(vscode.l10n.t('Host name'), current?.name);
  const alias = await requiredInput(vscode.l10n.t('SSH alias'), current?.alias, (value) =>
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)
      ? undefined
      : vscode.l10n.t('Use only letters, numbers, dots, underscores, and hyphens.'),
  );
  const host = await requiredInput(vscode.l10n.t('Hostname or IP address'), current?.host);
  const portText = await requiredInput(
    vscode.l10n.t('SSH port'),
    String(current?.port ?? 22),
    (value) => {
      const port = Number(value);
      return Number.isInteger(port) && port >= 1 && port <= 65_535
        ? undefined
        : vscode.l10n.t('Enter a port from 1 to 65535.');
    },
  );
  const username = await requiredInput(vscode.l10n.t('Username'), current?.username);
  const defaultPath = await optionalInput(
    vscode.l10n.t('Default remote folder (optional)'),
    current?.defaultPath,
    (value) =>
      value.length === 0 || value.startsWith('/')
        ? undefined
        : vscode.l10n.t('Enter an absolute POSIX path beginning with /.'),
  );
  const group = await optionalInput(vscode.l10n.t('Group (optional)'), current?.group);
  const keyStrategy = await promptForKeyStrategy(current?.keyStrategy, group, groupKeyId);
  const draft: ProfileDraft = {
    name,
    alias,
    host,
    port: Number(portText),
    username,
    ...(defaultPath.length === 0 ? {} : { defaultPath }),
    ...(group.length === 0 ? {} : { group }),
    keyStrategy,
  };
  const errors = validateProfileDraft(draft);
  if (errors.length > 0) {
    await vscode.window.showErrorMessage(
      vscode.l10n.t('Some host fields are invalid: {0}', errors.join(', ')),
    );
    throw new vscode.CancellationError();
  }
  return draft;
}

async function promptForKeyStrategy(
  current: KeyStrategy | undefined,
  group: string,
  groupKeyId?: (group: string) => string | undefined,
): Promise<KeyStrategy> {
  const items = [
    {
      label: vscode.l10n.t('Generated key for this host (Recommended)'),
      description: vscode.l10n.t('Creates a dedicated Ed25519 key in the SSH Onboard folder.'),
      strategyKind: 'generated-per-host' as const,
    },
    {
      label: vscode.l10n.t('Existing key (Advanced)'),
      description: vscode.l10n.t('Uses a private key that you already manage.'),
      strategyKind: 'existing' as const,
    },
    {
      label: vscode.l10n.t('Shared group key (Advanced)'),
      description: vscode.l10n.t('Shares one generated key with every host in this group.'),
      strategyKind: 'generated-per-group' as const,
    },
  ];
  const selected = await vscode.window.showQuickPick(items, {
    title: vscode.l10n.t('Key strategy'),
    placeHolder: vscode.l10n.t('The recommended option isolates each host.'),
    ignoreFocusOut: true,
  });
  if (selected === undefined) {
    throw new vscode.CancellationError();
  }
  if (selected.strategyKind === 'existing') {
    const chosen = await vscode.window.showOpenDialog({
      title: vscode.l10n.t('Select an existing SSH private key'),
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: vscode.l10n.t('Use this key'),
    });
    const privateKeyPath = chosen?.[0]?.fsPath;
    if (privateKeyPath === undefined) {
      throw new vscode.CancellationError();
    }
    return { kind: 'existing', privateKeyPath };
  }
  if (selected.strategyKind === 'generated-per-group') {
    if (group.length === 0) {
      await vscode.window.showErrorMessage(
        vscode.l10n.t('Enter a group before selecting a shared group key.'),
      );
      throw new vscode.CancellationError();
    }
    const accepted = await vscode.window.showWarningMessage(
      vscode.l10n.t(
        'A shared key increases the impact of key exposure. Continue only if every host in this group should share access.',
      ),
      { modal: true },
      vscode.l10n.t('Use shared group key'),
    );
    if (accepted === undefined) {
      throw new vscode.CancellationError();
    }
    const existingId = groupKeyId?.(group);
    return { kind: 'generated-per-group', groupId: group, keyId: existingId ?? randomUUID() };
  }
  if (current?.kind === 'generated-per-host') {
    return current;
  }
  return { kind: 'generated-per-host', keyId: randomUUID() };
}

async function requiredInput(
  title: string,
  value?: string,
  validateInput?: (value: string) => string | undefined,
): Promise<string> {
  const result = await vscode.window.showInputBox({
    title,
    ...(value === undefined ? {} : { value }),
    ignoreFocusOut: true,
    validateInput: (candidate) =>
      candidate.trim().length === 0
        ? vscode.l10n.t('This field is required.')
        : validateInput?.(candidate.trim()),
  });
  if (result === undefined) {
    throw new vscode.CancellationError();
  }
  return result.trim();
}

async function optionalInput(
  title: string,
  value?: string,
  validateInput?: (value: string) => string | undefined,
): Promise<string> {
  const result = await vscode.window.showInputBox({
    title,
    ...(value === undefined ? {} : { value }),
    ignoreFocusOut: true,
    validateInput: (candidate) => validateInput?.(candidate.trim()),
  });
  if (result === undefined) {
    throw new vscode.CancellationError();
  }
  return result.trim();
}
