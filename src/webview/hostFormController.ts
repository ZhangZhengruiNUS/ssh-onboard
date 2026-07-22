import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';

import * as vscode from 'vscode';

import { addHost, editHost, findGroupKeyId } from '../commands/profileCommands';
import { DomainError } from '../core/domainError';
import {
  validateProfileDraft,
  type KeyStrategy,
  type ProfileDraft,
  type ServerProfile,
} from '../domain/profiles';
import type { SafeLogStage } from '../logging/safeLog';
import type { ProfileStore } from '../services/profileStore';
import { readRemoteSshSettings } from '../services/remoteSettings';
import type { SshConfigService } from '../services/sshConfigService';
import type { HostTreeDataProvider } from '../views/hostTreeDataProvider';
import { renderHostFormHtml } from './hostFormHtml';
import { profileToHostFormDraftDto } from './hostFormModel';
import {
  HostFormProtocolError,
  parseHostFormMessage,
  type ExtensionToHostFormMessage,
  type HostFormDraftDto,
  type HostFormField,
  type HostFormSaveIntent,
} from './hostFormProtocol';
import { HostFormSession, HostFormSessionError } from './hostFormSession';

interface HostFormTarget {
  readonly mode: 'add' | 'edit';
  readonly profileId?: string;
  readonly revision: string;
  readonly initialDraft: HostFormDraftDto;
  dirty: boolean;
}

export interface HostFormControllerOptions {
  readonly extensionUri: vscode.Uri;
  readonly profiles: ProfileStore;
  readonly tree: HostTreeDataProvider;
  readonly sshConfig: SshConfigService;
  readonly initializeHost: (profileId: string) => Promise<void>;
  readonly runSafely: (stage: SafeLogStage, operation: () => Promise<void>) => Promise<void>;
}

export class HostFormController implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private target: HostFormTarget | undefined;
  private session: HostFormSession | undefined;
  private ready = false;
  private readonly panelDisposables: vscode.Disposable[] = [];

  public constructor(private readonly options: HostFormControllerOptions) {}

  public async openAdd(): Promise<void> {
    await this.open({ mode: 'add' });
  }

  public async openEdit(profileId: string): Promise<void> {
    await this.open({ mode: 'edit', profileId });
  }

  public dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
    this.target = undefined;
    this.session?.clear();
    this.session = undefined;
    for (const disposable of this.panelDisposables.splice(0)) {
      disposable.dispose();
    }
  }

  public get debugState(): Readonly<{
    open: boolean;
    mode?: 'add' | 'edit';
    profileId?: string;
    dirty: boolean;
    panelId?: string;
    profileCount: number;
  }> {
    return {
      open: this.panel !== undefined,
      ...(this.target?.mode === undefined ? {} : { mode: this.target.mode }),
      ...(this.target?.profileId === undefined ? {} : { profileId: this.target.profileId }),
      dirty: this.target?.dirty ?? false,
      ...(this.session === undefined ? {} : { panelId: this.session.panelId }),
      profileCount: this.options.profiles.list().length,
    };
  }

  public cancelForTests(): void {
    this.panel?.dispose();
  }

  private async open(request: {
    readonly mode: 'add' | 'edit';
    readonly profileId?: string;
  }): Promise<void> {
    if (this.isSameTarget(request)) {
      this.panel?.reveal(vscode.ViewColumn.Active, true);
      return;
    }
    if (this.target?.dirty === true) {
      const discard = await vscode.window.showWarningMessage(
        vscode.l10n.t('Discard the unsaved host form and open another host?'),
        { modal: true },
        vscode.l10n.t('Discard changes'),
      );
      if (discard === undefined) {
        throw new vscode.CancellationError();
      }
    }

    const profile =
      request.mode === 'edit' ? this.options.profiles.get(requiredId(request)) : undefined;
    this.ensurePanel();
    const session = this.session;
    if (session === undefined) {
      throw new DomainError('UNEXPECTED');
    }
    const revision = session.start(profile);
    this.target = {
      mode: request.mode,
      ...(profile === undefined ? {} : { profileId: profile.id }),
      revision,
      initialDraft: profileToHostFormDraftDto(profile),
      dirty: false,
    };
    this.updatePanelTitle();
    if (this.ready) {
      await this.postInitialize();
    }
    this.panel?.reveal(vscode.ViewColumn.Active, true);
  }

  private ensurePanel(): void {
    if (this.panel !== undefined) {
      return;
    }
    this.ready = false;
    this.session = new HostFormSession();
    this.panel = vscode.window.createWebviewPanel(
      'sshOnboard.hostForm',
      vscode.l10n.t('SSH host'),
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: false,
        localResourceRoots: [vscode.Uri.joinPath(this.options.extensionUri, 'media')],
      },
    );
    this.panel.webview.html = renderHostFormHtml(
      this.panel.webview,
      this.options.extensionUri,
      randomBytes(24).toString('base64'),
    );
    this.panelDisposables.push(
      this.panel.webview.onDidReceiveMessage((raw: unknown) => {
        void this.receive(raw).catch((error: unknown) =>
          this.reportFailure(normalizeSessionError(error)),
        );
      }),
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.target = undefined;
        this.ready = false;
        this.session?.clear();
        this.session = undefined;
        for (const disposable of this.panelDisposables.splice(0)) {
          disposable.dispose();
        }
      }),
    );
  }

  private async receive(raw: unknown): Promise<void> {
    let message;
    try {
      message = parseHostFormMessage(raw);
    } catch (error: unknown) {
      const detail = error instanceof HostFormProtocolError ? 'host-form-message' : undefined;
      await this.reportFailure(new DomainError('INVALID_PROFILE', detail));
      return;
    }
    if (message.type === 'ready') {
      this.ready = true;
      await this.postInitialize();
      return;
    }
    const target = this.target;
    const session = this.session;
    if (target === undefined || session === undefined) {
      await this.reportFailure(new DomainError('INVALID_PROFILE', 'host-form-session'));
      return;
    }
    try {
      session.assertRevision(message.revision);
      if (message.type === 'dirty') {
        target.dirty = message.dirty;
        return;
      }
      if (message.type === 'cancel') {
        this.panel?.dispose();
        return;
      }
      if (message.type === 'pickExistingKey') {
        await this.pickExistingKey(message.revision);
        return;
      }
      if (message.type === 'validate') {
        await this.validate(message.revision, message.sequence, message.draft);
        return;
      }
      await this.save(message.revision, message.intent, message.draft);
    } catch (error: unknown) {
      await this.reportFailure(normalizeSessionError(error));
    }
  }

  private async pickExistingKey(revision: string): Promise<void> {
    const chosen = await vscode.window.showOpenDialog({
      title: vscode.l10n.t('Select an existing SSH private key'),
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: vscode.l10n.t('Use this key'),
    });
    const privateKeyPath = chosen?.[0]?.fsPath;
    if (privateKeyPath === undefined || this.session === undefined) {
      return;
    }
    const token = this.session.createExistingKeySelection(revision, privateKeyPath);
    await this.post({
      type: 'existingKeySelected',
      revision,
      selectionLabel: path.win32.basename(privateKeyPath),
      selectionToken: token,
    });
  }

  private async validate(revision: string, sequence: number, dto: HostFormDraftDto): Promise<void> {
    const target = this.target;
    if (target === undefined) {
      throw new DomainError('INVALID_PROFILE', 'host-form-session');
    }
    const errors: Partial<Record<HostFormField, string>> = {};
    let draft: ProfileDraft;
    try {
      draft = this.toProfileDraft(dto, revision, false);
    } catch (error: unknown) {
      if (error instanceof DomainError && error.detail === 'groupKey') {
        errors.group = vscode.l10n.t('Enter a group before selecting a shared group key.');
      } else if (
        (error instanceof DomainError && error.detail === 'existing-key-selection') ||
        error instanceof HostFormSessionError
      ) {
        errors.keyStrategy = vscode.l10n.t('Choose an existing private key before saving.');
      } else {
        throw error;
      }
      await this.post({ type: 'validation', revision, sequence, errors });
      return;
    }
    for (const field of validateProfileDraft(draft)) {
      errors[toFormField(field)] = fieldMessage(field);
    }
    const localAliasConflict = this.options.profiles
      .list()
      .some(
        (profile) =>
          profile.id !== target.profileId &&
          profile.alias.toLowerCase() === draft.alias.toLowerCase(),
      );
    if (localAliasConflict) {
      errors.alias = vscode.l10n.t('This alias is already used by another SSH Onboard host.');
    }
    if (Object.keys(errors).length > 0) {
      const suggestedAlias =
        errors.alias === undefined ? undefined : await this.suggestUniqueAlias(dto);
      await this.post({
        type: 'validation',
        revision,
        sequence,
        errors,
        ...(suggestedAlias === undefined ? {} : { suggestedAlias }),
      });
      return;
    }

    try {
      await this.preflightAlias(
        draft.alias,
        target.profileId ?? `draft-${this.session?.panelId ?? 'host'}`,
      );
      await this.post({ type: 'validation', revision, sequence, errors: {} });
    } catch (error: unknown) {
      if (
        error instanceof DomainError &&
        error.code === 'LOCAL_CONFIG_CONFLICT' &&
        error.detail === 'alias'
      ) {
        const suggestedAlias = await this.suggestUniqueAlias(dto);
        await this.post({
          type: 'validation',
          revision,
          sequence,
          errors: { alias: vscode.l10n.t('This alias already exists in your SSH config.') },
          ...(suggestedAlias === undefined ? {} : { suggestedAlias }),
        });
        return;
      }
      await this.post({
        type: 'operationError',
        revision,
        message: vscode.l10n.t(
          'Configuration preflight could not complete. Review the VS Code message before saving.',
        ),
      });
    }
  }

  private async save(
    revision: string,
    intent: HostFormSaveIntent,
    dto: HostFormDraftDto,
  ): Promise<void> {
    const target = this.target;
    const session = this.session;
    if (target === undefined || session === undefined) {
      throw new DomainError('INVALID_PROFILE', 'host-form-session');
    }
    let succeeded = false;
    let savedProfileId: string | undefined;
    await this.options.runSafely(stageFor(target), async () => {
      const draft = this.toProfileDraftSafely(dto, revision, false);
      const errors = validateProfileDraft(draft);
      if (errors.length > 0) {
        throw new DomainError('INVALID_PROFILE', 'host-form-fields');
      }
      await this.assertAliasAvailableWhenReadable(
        draft.alias,
        target.profileId ?? `draft-${session.panelId}`,
      );
      if (
        draft.keyStrategy.kind === 'generated-per-group' &&
        shouldConfirmSharedKey(target, draft)
      ) {
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
      }
      const committedDraft = this.toProfileDraftSafely(dto, revision, true);
      if (target.mode === 'add') {
        const profile = await addHost(committedDraft, this.options.profiles, this.options.tree);
        savedProfileId = profile.id;
      } else {
        const profileId = target.profileId;
        if (profileId === undefined) {
          throw new DomainError('PROFILE_NOT_FOUND');
        }
        await editHost(
          profileId,
          committedDraft,
          this.options.profiles,
          this.options.tree,
          this.options.sshConfig,
          (profile) => {
            try {
              session.assertProfile(profile);
            } catch (error: unknown) {
              throw normalizeSessionError(error);
            }
          },
        );
      }
      succeeded = true;
    });
    if (succeeded) {
      this.panel?.dispose();
      if (intent === 'save-and-initialize' && savedProfileId !== undefined) {
        await this.options.initializeHost(savedProfileId);
      }
      return;
    }
    await this.post({
      type: 'operationError',
      revision,
      message: vscode.l10n.t('The host was not saved. Review the VS Code message and try again.'),
    });
  }

  private toProfileDraft(
    dto: HostFormDraftDto,
    revision: string,
    consumeToken: boolean,
  ): ProfileDraft {
    const target = this.target;
    const current =
      target?.profileId === undefined ? undefined : this.options.profiles.get(target.profileId);
    const keyStrategy = this.toKeyStrategy(dto, revision, current, consumeToken);
    return {
      name: dto.name,
      host: dto.host,
      port: dto.port,
      username: dto.username,
      alias: dto.alias,
      ...(dto.defaultPath === undefined ? {} : { defaultPath: dto.defaultPath }),
      ...(dto.group === undefined ? {} : { group: dto.group }),
      keyStrategy,
    };
  }

  private toProfileDraftSafely(
    dto: HostFormDraftDto,
    revision: string,
    consumeToken: boolean,
  ): ProfileDraft {
    try {
      return this.toProfileDraft(dto, revision, consumeToken);
    } catch (error: unknown) {
      throw normalizeSessionError(error);
    }
  }

  private toKeyStrategy(
    dto: HostFormDraftDto,
    revision: string,
    current: ServerProfile | undefined,
    consumeToken: boolean,
  ): KeyStrategy {
    if (dto.keyStrategy.kind === 'generated-per-host') {
      return current?.keyStrategy.kind === 'generated-per-host'
        ? current.keyStrategy
        : { kind: 'generated-per-host', keyId: randomUUID() };
    }
    if (dto.keyStrategy.kind === 'generated-per-group') {
      const group = dto.group;
      if (group === undefined) {
        throw new DomainError('INVALID_PROFILE', 'groupKey');
      }
      if (
        current?.keyStrategy.kind === 'generated-per-group' &&
        current.keyStrategy.groupId.toLowerCase() === group.toLowerCase()
      ) {
        return current.keyStrategy;
      }
      return {
        kind: 'generated-per-group',
        groupId: group,
        keyId: findGroupKeyId(this.options.profiles, group) ?? randomUUID(),
      };
    }
    const token = dto.keyStrategy.selectionToken;
    if (token !== undefined) {
      const session = this.session;
      if (session === undefined) {
        throw new HostFormSessionError('no-session');
      }
      const privateKeyPath = consumeToken
        ? session.consumeExistingKeySelection(revision, token)
        : session.inspectExistingKeySelection(revision, token);
      return { kind: 'existing', privateKeyPath };
    }
    if (current?.keyStrategy.kind === 'existing') {
      return current.keyStrategy;
    }
    throw new DomainError('INVALID_PROFILE', 'existing-key-selection');
  }

  private async preflightAlias(alias: string, profileId: string): Promise<void> {
    const settings = readRemoteSshSettings();
    await this.options.sshConfig.preflightAlias(
      () => this.options.profiles.list(),
      this.options.sshConfig.resolvePaths(settings.configFile),
      { id: profileId, alias },
    );
  }

  private async assertAliasAvailableWhenReadable(alias: string, profileId: string): Promise<void> {
    try {
      await this.preflightAlias(alias, profileId);
    } catch (error: unknown) {
      if (error instanceof DomainError && error.code === 'LOCAL_CONFIG_CONFLICT') {
        if (error.detail === 'alias') {
          throw error;
        }
        // Saving an uninitialized profile does not modify SSH files. Full
        // preflight remains mandatory before Initialize or an artifact edit.
        return;
      }
      throw error;
    }
  }

  private async suggestUniqueAlias(dto: HostFormDraftDto): Promise<string | undefined> {
    const base = aliasBase(dto.alias || dto.host || dto.name);
    for (let index = 1; index <= 50; index += 1) {
      const candidate = index === 1 ? base : `${base}-${String(index)}`;
      const localConflict = this.options.profiles
        .list()
        .some(
          (profile) =>
            profile.id !== this.target?.profileId &&
            profile.alias.toLowerCase() === candidate.toLowerCase(),
        );
      if (localConflict) {
        continue;
      }
      try {
        await this.preflightAlias(
          candidate,
          this.target?.profileId ?? `draft-${this.session?.panelId ?? 'host'}`,
        );
        return candidate;
      } catch (error: unknown) {
        if (!(
          error instanceof DomainError &&
          error.code === 'LOCAL_CONFIG_CONFLICT' &&
          error.detail === 'alias'
        )) {
          return undefined;
        }
      }
    }
    return undefined;
  }

  private async postInitialize(): Promise<void> {
    const target = this.target;
    if (target === undefined) {
      return;
    }
    await this.post({
      type: 'initialize',
      mode: target.mode,
      revision: target.revision,
      draft: target.initialDraft,
    });
  }

  private async post(message: ExtensionToHostFormMessage): Promise<void> {
    await this.panel?.webview.postMessage(message);
  }

  private async reportFailure(error: unknown): Promise<void> {
    const stage = this.target === undefined ? 'add-host' : stageFor(this.target);
    const safeError = error instanceof Error ? error : new DomainError('UNEXPECTED');
    await this.options.runSafely(stage, () => Promise.reject(safeError));
  }

  private isSameTarget(request: {
    readonly mode: 'add' | 'edit';
    readonly profileId?: string;
  }): boolean {
    return (
      this.panel !== undefined &&
      this.target?.mode === request.mode &&
      this.target.profileId === request.profileId
    );
  }

  private updatePanelTitle(): void {
    if (this.panel === undefined || this.target === undefined) {
      return;
    }
    this.panel.title =
      this.target.mode === 'add' ? vscode.l10n.t('Add SSH host') : vscode.l10n.t('Edit SSH host');
  }
}

function aliasBase(source: string): string {
  const normalized = source
    .trim()
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^[^A-Za-z0-9]+/u, '')
    .replace(/-+$/u, '')
    .slice(0, 50);
  return normalized.length === 0 ? 'ssh-host' : normalized;
}

function toFormField(field: string): HostFormField {
  if (field === 'groupKey') {
    return 'group';
  }
  if (
    field === 'name' ||
    field === 'host' ||
    field === 'port' ||
    field === 'username' ||
    field === 'alias' ||
    field === 'defaultPath' ||
    field === 'group'
  ) {
    return field;
  }
  return 'keyStrategy';
}

function fieldMessage(field: string): string {
  if (field === 'port') {
    return vscode.l10n.t('Enter a port from 1 to 65535.');
  }
  if (field === 'alias') {
    return vscode.l10n.t('Use only letters, numbers, dots, underscores, and hyphens.');
  }
  if (field === 'defaultPath') {
    return vscode.l10n.t('Enter an absolute POSIX path beginning with /.');
  }
  if (field === 'groupKey') {
    return vscode.l10n.t('Enter a group before selecting a shared group key.');
  }
  return vscode.l10n.t('This field is required or contains an unsupported value.');
}

function shouldConfirmSharedKey(target: HostFormTarget, draft: ProfileDraft): boolean {
  if (draft.keyStrategy.kind !== 'generated-per-group') {
    return false;
  }
  return target.initialDraft.keyStrategy.kind !== 'generated-per-group';
}

function requiredId(request: { readonly profileId?: string }): string {
  if (request.profileId === undefined) {
    throw new DomainError('PROFILE_NOT_FOUND');
  }
  return request.profileId;
}

function stageFor(target: HostFormTarget): SafeLogStage {
  return target.mode === 'add' ? 'add-host' : 'edit-host';
}

function normalizeSessionError(error: unknown): DomainError | vscode.CancellationError {
  if (error instanceof vscode.CancellationError || error instanceof DomainError) {
    return error;
  }
  if (error instanceof HostFormSessionError) {
    return error.reason === 'stale-profile' || error.reason === 'stale-revision'
      ? new DomainError('LOCAL_CONFIG_CONFLICT', 'concurrent-change')
      : new DomainError('INVALID_PROFILE', 'host-form-token');
  }
  return new DomainError('UNEXPECTED');
}
