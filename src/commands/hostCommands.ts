import { randomUUID } from 'node:crypto';

import * as vscode from 'vscode';
import type { Client } from 'ssh2';

import { DomainError } from '../core/domainError';
import { omitProperties } from '../core/objects';
import { createDeploymentPlan } from '../domain/authorizedKeys';
import type { HostKeyObservation } from '../domain/hostKeys';
import type { LocalKeyReference, ServerProfile, TrustedHostKey } from '../domain/profiles';
import type { WindowsOpenSsh } from '../platform/windows/openssh';
import type { AuthorizedKeysService } from '../services/authorizedKeysService';
import type { BootstrapClient } from '../services/bootstrapClient';
import type { KeyManager } from '../services/keyManager';
import type { ProfileStore } from '../services/profileStore';
import { readRemoteSshSettings } from '../services/remoteSettings';
import type { RemoteLayoutService } from '../services/remoteLayoutService';
import type { RemoteSshLauncher } from '../services/remoteSshLauncher';
import { openSftp } from '../services/ssh2Utils';
import type { SshConfigPaths, SshConfigService } from '../services/sshConfigService';
import type { VerificationService } from '../services/verificationService';
import type { HostTreeDataProvider, HostTreeItem } from '../views/hostTreeDataProvider';
import { pickProfile } from './profileCommands';

export interface HostCommandServices {
  readonly profiles: ProfileStore;
  readonly tree: HostTreeDataProvider;
  readonly openssh: WindowsOpenSsh;
  readonly keys: KeyManager;
  readonly bootstrap: BootstrapClient;
  readonly remoteLayout: RemoteLayoutService;
  readonly authorizedKeys: AuthorizedKeysService;
  readonly sshConfig: SshConfigService;
  readonly verification: VerificationService;
  readonly launcher: RemoteSshLauncher;
  readonly hostKeyReview: {
    review(profile: ServerProfile, observation: HostKeyObservation): Promise<TrustedHostKey>;
  };
}

export async function initializeHost(
  item: HostTreeItem | undefined,
  services: HostCommandServices,
): Promise<void> {
  assertWindows();
  const selected = item?.profile ?? (await pickProfile(services.profiles));
  await initializeHostById(selected.id, services);
}

export async function initializeHostById(
  profileId: string,
  services: HostCommandServices,
): Promise<void> {
  assertWindows();
  await services.profiles.withProfileOperation(profileId, (profile) =>
    initializeProfile(profile, services),
  );
}

async function initializeProfile(
  initialProfile: ServerProfile,
  services: HostCommandServices,
): Promise<void> {
  let profile = initialProfile;
  const settings = readRemoteSshSettings();
  const paths = services.sshConfig.resolvePaths(settings.configFile);
  const discovery = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('Preparing {0}', profile.name),
      cancellable: true,
    },
    async (progress, cancellationToken) => {
      const abort = new AbortController();
      const cancellation = cancellationToken.onCancellationRequested(() => abort.abort());
      try {
        progress.report({ message: vscode.l10n.t('Checking local SSH configuration...') });
        await services.sshConfig.preflight(() => services.profiles.list(), paths, {
          id: profile.id,
          alias: profile.alias,
        });
        throwIfCancelled(cancellationToken);
        progress.report({ message: vscode.l10n.t('Checking Windows OpenSSH...') });
        const tools = await services.openssh.discover(settings.sshPath);
        throwIfCancelled(cancellationToken);
        progress.report({ message: vscode.l10n.t('Contacting the server for its identity...') });
        const observation = await services.bootstrap.probeHostKey(profile, abort.signal);
        throwIfCancelled(cancellationToken);
        return { observation, tools };
      } finally {
        cancellation.dispose();
      }
    },
  );
  const trustedHostKey = await services.hostKeyReview.review(profile, discovery.observation);
  let localKey: LocalKeyReference;
  try {
    localKey = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Preparing {0}', profile.name),
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: vscode.l10n.t('Preparing the local SSH key...') });
        const preparedKey = await services.keys.prepare(profile, discovery.tools);
        const profileWithoutError = omitProperties(profile, [
          'lastErrorCode',
          'lastVerifiedAt',
          'verificationContext',
        ]);
        profile = {
          ...profileWithoutError,
          localKey: preparedKey,
          trustedHostKey,
        };
        progress.report({ message: vscode.l10n.t('Saving the trusted host identity...') });
        await services.profiles.withConfigurationOperation(async () => {
          await services.profiles.update(profile);
          await services.sshConfig.persistKnownHosts(() => services.profiles.list(), paths);
        });
        return preparedKey;
      },
    );
  } catch (error: unknown) {
    await recordFailure(services, profile, error);
    throw error;
  }
  services.tree.refresh();

  const password = await vscode.window.showInputBox({
    title: vscode.l10n.t('One-time SSH password'),
    prompt: vscode.l10n.t('Used only for this initialization and never saved.'),
    password: true,
    ignoreFocusOut: true,
  });
  if (password === undefined) {
    throw new vscode.CancellationError();
  }

  let client: Client | undefined;
  try {
    profile = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Setting up key access for {0}', profile.name),
        cancellable: false,
      },
      async (progress) => {
        progress.report({ message: vscode.l10n.t('Authenticating with the one-time password...') });
        const connectedClient = await services.bootstrap.connectWithPassword(
          profile,
          password,
          trustedHostKey,
        );
        client = connectedClient;
        const plan = await services.profiles.withConfigurationOperation(async () => {
          progress.report({ message: vscode.l10n.t('Rechecking local SSH configuration...') });
          await services.sshConfig.preflight(() => services.profiles.list(), paths, {
            id: profile.id,
            alias: profile.alias,
          });
          const nextPlan =
            profile.pendingAuthorization ??
            createDeploymentPlan(localKey.publicKeyLine, profile.id, randomUUID());
          if (profile.pendingAuthorization === undefined) {
            profile = { ...profile, pendingAuthorization: nextPlan };
            await services.profiles.update(profile);
          }
          return nextPlan;
        });
        progress.report({ message: vscode.l10n.t('Checking the remote SSH directory...') });
        const layout = await services.remoteLayout.probe(connectedClient);
        const sftp = await openSftp(connectedClient);
        try {
          progress.report({ message: vscode.l10n.t('Installing the public key safely...') });
          const authorization = await services.authorizedKeys.deploy(sftp, localKey, layout, plan);
          const profileWithoutPending = omitProperties(profile, ['pendingAuthorization']);
          profile = {
            ...profileWithoutPending,
            authorization,
            resolvedHome: layout.home,
          };
          await services.profiles.update(profile);
        } finally {
          sftp.end();
        }
        return services.profiles.withConfigurationOperation(async () => {
          progress.report({ message: vscode.l10n.t('Verifying passwordless SSH access...') });
          return applyVerifyAndPersist(profile, services, discovery.tools, paths);
        });
      },
    );
  } catch (error: unknown) {
    await recordFailure(services, profile, error);
    throw error;
  } finally {
    client?.end();
  }

  services.tree.refresh();
  const connectNow = await vscode.window.showInformationMessage(
    vscode.l10n.t('{0} is ready for passwordless Remote - SSH connections.', profile.name),
    vscode.l10n.t('Open default folder'),
  );
  if (connectNow !== undefined) {
    await services.launcher.open(profile);
  }
}

export async function testKeyConnection(
  item: HostTreeItem | undefined,
  services: HostCommandServices,
): Promise<void> {
  assertWindows();
  const selected = item?.profile ?? (await pickProfile(services.profiles));
  await services.profiles.withConfigurationOperation(() =>
    services.profiles.withProfileOperation(selected.id, (profile) =>
      testProfileConnection(profile, services),
    ),
  );
}

async function testProfileConnection(
  profile: ServerProfile,
  services: HostCommandServices,
): Promise<void> {
  const settings = readRemoteSshSettings();
  const tools = await services.openssh.discover(settings.sshPath);
  const paths = services.sshConfig.resolvePaths(settings.configFile);
  await applyVerifyAndPersist(profile, services, tools, paths);
  services.tree.refresh();
  await vscode.window.showInformationMessage(vscode.l10n.t('Key connection verified.'));
}

export async function connectHost(
  item: HostTreeItem | undefined,
  services: HostCommandServices,
): Promise<void> {
  assertWindows();
  const selected = item?.profile ?? (await pickProfile(services.profiles));
  await services.profiles.withConfigurationOperation(() =>
    services.profiles.withProfileOperation(selected.id, (profile) =>
      connectProfile(profile, services),
    ),
  );
}

async function connectProfile(
  profile: ServerProfile,
  services: HostCommandServices,
): Promise<void> {
  const settings = readRemoteSshSettings();
  const tools = await services.openssh.discover(settings.sshPath);
  const paths = services.sshConfig.resolvePaths(settings.configFile);
  const verified = await applyVerifyAndPersist(profile, services, tools, paths);
  services.tree.refresh();
  await services.launcher.open(verified);
}

export async function revokeKey(
  item: HostTreeItem | undefined,
  services: HostCommandServices,
): Promise<void> {
  assertWindows();
  const selected = item?.profile ?? (await pickProfile(services.profiles));
  await services.profiles.withConfigurationOperation(() =>
    services.profiles.withProfileOperation(selected.id, (profile) =>
      revokeProfileKey(profile, services),
    ),
  );
}

async function revokeProfileKey(
  initialProfile: ServerProfile,
  services: HostCommandServices,
): Promise<void> {
  let profile = initialProfile;
  const managedAuthorization =
    profile.authorization?.ownership === 'managed'
      ? profile.authorization
      : profile.pendingAuthorization;
  if (
    managedAuthorization === undefined ||
    profile.localKey === undefined ||
    profile.trustedHostKey === undefined
  ) {
    throw new DomainError('FEATURE_UNAVAILABLE', 'managed-authorization-required');
  }
  const confirmed = await vscode.window.showWarningMessage(
    vscode.l10n.t(
      'Revoke the exact public key deployed by SSH Onboard for {0}? Confirm another login method or a server console is available first; otherwise you may lose SSH access.',
      profile.name,
    ),
    { modal: true },
    vscode.l10n.t('Revoke deployed key'),
  );
  if (confirmed === undefined) {
    throw new vscode.CancellationError();
  }
  let client = await services.bootstrap
    .connectWithPrivateKey(profile, profile.localKey.privateKeyPath, profile.trustedHostKey)
    .catch(() => undefined);
  if (client === undefined) {
    const password = await vscode.window.showInputBox({
      title: vscode.l10n.t('One-time SSH password'),
      prompt: vscode.l10n.t('The selected private key could not open a bootstrap connection.'),
      password: true,
      ignoreFocusOut: true,
    });
    if (password === undefined) {
      throw new vscode.CancellationError();
    }
    client = await services.bootstrap.connectWithPassword(
      profile,
      password,
      profile.trustedHostKey,
    );
  }
  try {
    const layout = await services.remoteLayout.probe(client);
    const sftp = await openSftp(client);
    await services.authorizedKeys.revoke(
      sftp,
      { ...profile, authorization: managedAuthorization },
      layout,
    );
    sftp.end();
    const cleanProfile = omitProperties(profile, [
      'authorization',
      'pendingAuthorization',
      'lastVerifiedAt',
      'verificationContext',
      'lastErrorCode',
    ]);
    profile = cleanProfile;
    await services.profiles.update(profile);
    const settings = readRemoteSshSettings();
    await services.sshConfig.synchronize(
      () => services.profiles.list(),
      services.sshConfig.resolvePaths(settings.configFile),
    );
    services.tree.refresh();
  } finally {
    client.end();
  }
}

async function applyVerifyAndPersist(
  profile: ServerProfile,
  services: HostCommandServices,
  tools: Awaited<ReturnType<WindowsOpenSsh['discover']>>,
  paths: SshConfigPaths,
): Promise<ServerProfile> {
  const safeProfile = requireLocalKeyAndTrust(profile);
  try {
    await services.sshConfig.apply(() => services.profiles.list(), safeProfile, tools, paths);
    const result = await services.verification.verify(safeProfile, tools, paths);
    const profileWithoutError = omitProperties(profile, ['lastErrorCode']);
    const next: ServerProfile = {
      ...profileWithoutError,
      resolvedHome: result.resolvedHome,
      lastVerifiedAt: result.verifiedAt,
      verificationContext: {
        sshPath: tools.ssh,
        configFile: paths.userConfig,
        keyFingerprint: safeProfile.localKey.fingerprint,
        hostKeyFingerprint: safeProfile.trustedHostKey.fingerprint,
      },
    };
    await services.profiles.update(next);
    return next;
  } catch (error: unknown) {
    await recordFailure(services, profile, error);
    throw error;
  }
}

function throwIfCancelled(token: vscode.CancellationToken): void {
  if (token.isCancellationRequested) {
    throw new vscode.CancellationError();
  }
}

async function recordFailure(
  services: HostCommandServices,
  profile: ServerProfile,
  error: unknown,
): Promise<void> {
  const code = error instanceof DomainError ? error.code : 'UNEXPECTED';
  await services.profiles.update(clearUndefined({ ...profile, lastErrorCode: code }));
  services.tree.refresh();
}

function requireLocalKeyAndTrust(
  profile: ServerProfile,
): ServerProfile & Required<Pick<ServerProfile, 'localKey' | 'trustedHostKey'>> {
  if (profile.localKey === undefined || profile.trustedHostKey === undefined) {
    throw new DomainError('KEY_VERIFICATION_FAILED');
  }
  return profile as ServerProfile & Required<Pick<ServerProfile, 'localKey' | 'trustedHostKey'>>;
}

function assertWindows(): void {
  if (process.platform !== 'win32') {
    throw new DomainError('UNSUPPORTED_PLATFORM');
  }
}

function clearUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
