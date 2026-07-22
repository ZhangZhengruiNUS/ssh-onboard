import * as vscode from 'vscode';

import { DomainError } from '../core/domainError';

export interface RemoteSshSettings {
  readonly sshPath?: string;
  readonly configFile?: string;
}

export function readRemoteSshSettings(
  configuration: Pick<vscode.WorkspaceConfiguration, 'inspect'> = vscode.workspace.getConfiguration(
    'remote.SSH',
  ),
): RemoteSshSettings {
  return {
    ...readGlobalString(configuration, 'path', 'remote.SSH.path', 'sshPath'),
    ...readGlobalString(configuration, 'configFile', 'remote.SSH.configFile', 'configFile'),
  };
}

function readGlobalString(
  configuration: Pick<vscode.WorkspaceConfiguration, 'inspect'>,
  key: string,
  settingName: string,
  resultKey: keyof RemoteSshSettings,
): Partial<RemoteSshSettings> {
  const inspected = configuration.inspect<unknown>(key);
  if (inspected === undefined) {
    return {};
  }
  if (
    inspected.workspaceFolderValue !== undefined ||
    inspected.workspaceValue !== undefined ||
    inspected.workspaceFolderLanguageValue !== undefined ||
    inspected.workspaceLanguageValue !== undefined
  ) {
    throw new DomainError('LOCAL_CONFIG_CONFLICT', `${settingName}:workspace`);
  }
  const value = inspected.globalLanguageValue ?? inspected.globalValue;
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new DomainError('LOCAL_CONFIG_CONFLICT', settingName);
  }
  return { [resultKey]: value.trim() };
}
