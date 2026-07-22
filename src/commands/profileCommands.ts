import os from 'node:os';
import path from 'node:path';

import * as vscode from 'vscode';

import { DomainError } from '../core/domainError';
import { createDiagnosticReport } from '../domain/diagnostics';
import type { ProfileDraft, ServerProfile } from '../domain/profiles';
import type { ProfileStore } from '../services/profileStore';
import { readRemoteSshSettings } from '../services/remoteSettings';
import type { SshConfigPaths, SshConfigService } from '../services/sshConfigService';
import type { HostTreeDataProvider, HostTreeItem } from '../views/hostTreeDataProvider';
import { promptForProfile } from './profilePrompts';

export async function addHost(profiles: ProfileStore, tree: HostTreeDataProvider): Promise<void> {
  const draft = await promptForProfile(undefined, (group) => findGroupKeyId(profiles, group));
  await profiles.add(draft);
  tree.refresh();
}

export async function editHost(
  item: HostTreeItem | undefined,
  profiles: ProfileStore,
  tree: HostTreeDataProvider,
  sshConfig?: SshConfigService,
): Promise<void> {
  const selected = item?.profile ?? (await pickProfile(profiles));
  await profiles.withConfigurationOperation(() =>
    profiles.withProfileOperation(selected.id, async (profile) => {
      const draft = await promptForProfile(profile, (group) => findGroupKeyId(profiles, group));
      await updateProfileAndArtifacts(profile, draft, profiles, sshConfig);
    }),
  );
  tree.refresh();
}

export async function removeHost(
  item: HostTreeItem | undefined,
  profiles: ProfileStore,
  tree: HostTreeDataProvider,
  sshConfig?: SshConfigService,
): Promise<void> {
  const selected = item?.profile ?? (await pickProfile(profiles));
  await profiles.withConfigurationOperation(() =>
    profiles.withProfileOperation(selected.id, async (profile) => {
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t(
          'Remove {0} from SSH Onboard? This does not revoke any key already deployed to the server.',
          profile.name,
        ),
        { modal: true },
        vscode.l10n.t('Remove local profile'),
      );
      if (choice === undefined) {
        throw new vscode.CancellationError();
      }
      if (
        profile.authorization?.ownership === 'managed' ||
        profile.pendingAuthorization !== undefined
      ) {
        throw new DomainError('LOCAL_CONFIG_CONFLICT', 'revoke-before-remove');
      }
      await removeProfileAndArtifacts(profile, profiles, sshConfig);
    }),
  );
  tree.refresh();
}

async function updateProfileAndArtifacts(
  profile: ServerProfile,
  draft: ProfileDraft,
  profiles: ProfileStore,
  sshConfig: SshConfigService | undefined,
): Promise<void> {
  const artifactMode = profileArtifactMode(profile);
  if (sshConfig === undefined || artifactMode === 'none') {
    await profiles.updateDraft(profile.id, draft);
    return;
  }
  const projected = profiles.projectUpdateDraft(profile.id, draft);
  const futureProfiles = (): readonly ServerProfile[] =>
    profiles.list().map((candidate) => (candidate.id === projected.id ? projected : candidate));
  const paths = resolveConfigPaths(sshConfig);
  if (artifactMode === 'known-hosts') {
    await sshConfig.persistKnownHosts(() => profiles.list(), paths);
  } else {
    await sshConfig.preflight(() => profiles.list(), paths, {
      id: profile.id,
      alias: draft.alias,
    });
  }
  if (artifactMode === 'known-hosts') {
    await sshConfig.persistKnownHosts(futureProfiles, paths);
  } else {
    await sshConfig.synchronize(futureProfiles, paths);
  }
  try {
    await profiles.updateDraft(profile.id, draft);
  } catch (error: unknown) {
    await restoreArtifacts(profiles, sshConfig, paths, artifactMode);
    throw error;
  }
}

async function removeProfileAndArtifacts(
  profile: ServerProfile,
  profiles: ProfileStore,
  sshConfig: SshConfigService | undefined,
): Promise<void> {
  const artifactMode = profileArtifactMode(profile);
  if (sshConfig === undefined || artifactMode === 'none') {
    await profiles.remove(profile.id);
    return;
  }
  const paths = resolveConfigPaths(sshConfig);
  if (artifactMode === 'known-hosts') {
    await sshConfig.persistKnownHosts(() => profiles.list(), paths);
  } else {
    await sshConfig.preflight(() => profiles.list(), paths);
  }
  const futureProfiles = (): readonly ServerProfile[] =>
    profiles.list().filter((candidate) => candidate.id !== profile.id);
  if (artifactMode === 'known-hosts') {
    await sshConfig.persistKnownHosts(futureProfiles, paths);
  } else {
    await sshConfig.synchronize(futureProfiles, paths);
  }
  try {
    await profiles.remove(profile.id);
  } catch (error: unknown) {
    await restoreArtifacts(profiles, sshConfig, paths, artifactMode);
    throw error;
  }
}

async function restoreArtifacts(
  profiles: ProfileStore,
  sshConfig: SshConfigService,
  paths: SshConfigPaths,
  mode: 'known-hosts' | 'managed-host',
): Promise<void> {
  if (mode === 'known-hosts') {
    await sshConfig.persistKnownHosts(() => profiles.list(), paths);
    return;
  }
  await sshConfig.synchronize(() => profiles.list(), paths);
}

function profileArtifactMode(profile: ServerProfile): 'none' | 'known-hosts' | 'managed-host' {
  if (
    profile.localKey !== undefined &&
    profile.trustedHostKey !== undefined &&
    profile.authorization !== undefined
  ) {
    return 'managed-host';
  }
  return profile.trustedHostKey === undefined ? 'none' : 'known-hosts';
}

function resolveConfigPaths(sshConfig: SshConfigService): SshConfigPaths {
  const settings = readRemoteSshSettings();
  return sshConfig.resolvePaths(settings.configFile);
}

export async function searchHosts(profiles: ProfileStore): Promise<HostTreeItem | undefined> {
  const entries = profiles.list().map((profile) => ({
    label: profile.name,
    description: `${profile.username}@${profile.host}:${String(profile.port)}`,
    ...((profile.defaultPath ?? profile.resolvedHome) === undefined
      ? {}
      : { detail: profile.defaultPath ?? profile.resolvedHome }),
    profile,
  }));
  const selected = await vscode.window.showQuickPick(entries, {
    title: vscode.l10n.t('Search SSH hosts'),
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: true,
  });
  return selected === undefined ? undefined : ({ profile: selected.profile } as HostTreeItem);
}

export async function exportProfiles(profiles: ProfileStore): Promise<void> {
  const hosts = profiles.list().map((profile) => ({
    name: profile.name,
    alias: profile.alias,
    host: profile.host,
    port: profile.port,
    username: profile.username,
    ...(profile.defaultPath === undefined ? {} : { defaultPath: profile.defaultPath }),
    ...(profile.group === undefined ? {} : { group: profile.group }),
    keyStrategy: profile.keyStrategy.kind,
  }));
  const confirmed = await vscode.window.showWarningMessage(
    vscode.l10n.t(
      'Export {0} host profiles? The file contains names, aliases, groups, default paths, server addresses, and usernames, but no passwords, keys, key paths, or trust records.',
      hosts.length,
    ),
    { modal: true },
    vscode.l10n.t('Export sanitized profiles'),
  );
  if (confirmed === undefined) {
    throw new vscode.CancellationError();
  }
  const target = await vscode.window.showSaveDialog({
    title: vscode.l10n.t('Export SSH Onboard profiles'),
    defaultUri: vscode.Uri.file(path.join(os.homedir(), 'ssh-onboard-profiles.json')),
    filters: { JSON: ['json'] },
  });
  if (target === undefined) {
    throw new vscode.CancellationError();
  }
  const payload = Buffer.from(
    `${JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), hosts }, undefined, 2)}\n`,
    'utf8',
  );
  await vscode.workspace.fs.writeFile(target, payload);
  await vscode.window.showInformationMessage(vscode.l10n.t('Sanitized profiles exported.'));
}

export async function showDiagnostics(
  item: HostTreeItem | undefined,
  profiles: ProfileStore,
  extensionVersion: string,
): Promise<void> {
  const profile = item?.profile ?? (await pickProfile(profiles));
  const remoteSsh = vscode.extensions.getExtension('ms-vscode-remote.remote-ssh');
  const report = createDiagnosticReport(profile, extensionVersion, {
    platform: process.platform,
    architecture: process.arch,
    vscodeVersion: vscode.version,
    remoteSshInstalled: remoteSsh !== undefined,
    remoteSshActive: remoteSsh?.isActive ?? false,
  });
  const document = await vscode.workspace.openTextDocument({
    language: 'json',
    content: `${JSON.stringify(report, undefined, 2)}\n`,
  });
  await vscode.window.showTextDocument(document, { preview: true });
}

export async function pickProfile(
  profiles: ProfileStore,
): Promise<ReturnType<ProfileStore['get']>> {
  const entries = profiles.list().map((profile) => ({
    label: profile.name,
    description: profile.alias,
    profile,
  }));
  const selected = await vscode.window.showQuickPick(entries, {
    title: vscode.l10n.t('Select an SSH host'),
    ignoreFocusOut: true,
  });
  if (selected === undefined) {
    throw new vscode.CancellationError();
  }
  return selected.profile;
}

function findGroupKeyId(profiles: ProfileStore, group: string): string | undefined {
  for (const profile of profiles.list()) {
    if (
      profile.group?.toLowerCase() === group.toLowerCase() &&
      profile.keyStrategy.kind === 'generated-per-group'
    ) {
      return profile.keyStrategy.keyId;
    }
  }
  return undefined;
}
