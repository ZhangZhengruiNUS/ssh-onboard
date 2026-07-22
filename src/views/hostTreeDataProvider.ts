import * as vscode from 'vscode';

import { getProfileStatus, type ProfileStatus, type ServerProfile } from '../domain/profiles';
import type { ProfileStore } from '../services/profileStore';

export type HostTreeNode = GroupTreeItem | HostTreeItem;

export class HostTreeDataProvider implements vscode.TreeDataProvider<HostTreeNode> {
  private readonly changeEmitter = new vscode.EventEmitter<HostTreeNode | undefined>();
  public readonly onDidChangeTreeData = this.changeEmitter.event;

  public constructor(private readonly profiles?: ProfileStore) {}

  public refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  public getTreeItem(element: HostTreeNode): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: HostTreeNode): HostTreeNode[] {
    if (this.profiles === undefined) {
      return [];
    }
    const profiles = this.profiles.list();
    if (element instanceof GroupTreeItem) {
      return element.profiles.map((profile) => new HostTreeItem(profile));
    }
    if (element instanceof HostTreeItem) {
      return [];
    }

    const grouped = new Map<string, ServerProfile[]>();
    const ungrouped: HostTreeItem[] = [];
    for (const profile of profiles) {
      if (profile.group === undefined) {
        ungrouped.push(new HostTreeItem(profile));
        continue;
      }
      const current = grouped.get(profile.group) ?? [];
      current.push(profile);
      grouped.set(profile.group, current);
    }

    const groups = [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, members]) => new GroupTreeItem(name, members));
    return [...groups, ...ungrouped];
  }
}

export class GroupTreeItem extends vscode.TreeItem {
  public override readonly contextValue = 'sshOnboard.group';

  public constructor(
    public readonly groupName: string,
    public readonly profiles: readonly ServerProfile[],
  ) {
    super(groupName, vscode.TreeItemCollapsibleState.Expanded);
    this.description = vscode.l10n.t('{0} hosts', profiles.length);
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

export class HostTreeItem extends vscode.TreeItem {
  public override readonly contextValue: string;

  public constructor(public readonly profile: ServerProfile) {
    const status = getProfileStatus(profile);
    super(profile.name, vscode.TreeItemCollapsibleState.None);
    this.contextValue = `sshOnboard.host.${status}`;
    this.description = statusLabel(status);
    this.tooltip = createTooltip(profile, status);
    this.iconPath = statusIcon(status);
    const ready = status === 'ready';
    this.command = {
      command: ready ? 'sshOnboard.connectHost' : 'sshOnboard.initializeHost',
      title: ready
        ? vscode.l10n.t('Connect and Open Default Folder')
        : vscode.l10n.t('Initialize Key Access'),
      arguments: [this],
    };
  }
}

function statusLabel(status: ProfileStatus): string {
  switch (status) {
    case 'setup-required':
      return vscode.l10n.t('Setup required');
    case 'host-trusted':
      return vscode.l10n.t('Host trusted');
    case 'ready':
      return vscode.l10n.t('Ready');
    case 'needs-attention':
      return vscode.l10n.t('Needs attention');
  }
}

function statusIcon(status: ProfileStatus): vscode.ThemeIcon {
  switch (status) {
    case 'ready':
      return new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
    case 'needs-attention':
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
    case 'host-trusted':
      return new vscode.ThemeIcon('shield');
    case 'setup-required':
      return new vscode.ThemeIcon('circle-outline');
  }
}

function createTooltip(profile: ServerProfile, status: ProfileStatus): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString(undefined, true);
  tooltip.appendMarkdown(`**${escapeMarkdown(profile.name)}**\n\n`);
  tooltip.appendText(`${profile.username}@${profile.host}:${String(profile.port)}\n`);
  tooltip.appendText(`${profile.defaultPath ?? profile.resolvedHome ?? '/'}\n`);
  tooltip.appendText(`${statusLabel(status)}`);
  if (profile.lastVerifiedAt !== undefined) {
    tooltip.appendText(`\n${vscode.l10n.t('Last verified: {0}', profile.lastVerifiedAt)}`);
  }
  return tooltip;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!]/gu, '\\$&');
}
