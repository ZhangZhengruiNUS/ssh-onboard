import { randomUUID } from 'node:crypto';

import * as vscode from 'vscode';
import type { Client } from 'ssh2';

import { DomainError } from '../core/domainError';
import { omitProperties } from '../core/objects';
import { createDeploymentPlan } from '../domain/authorizedKeys';
import { knownHostsAddress } from '../domain/hostKeys';
import type { ServerProfile, TrustedHostKey } from '../domain/profiles';
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
}

export async function initializeHost(
  item: HostTreeItem | undefined,
  services: HostCommandServices,
): Promise<void> {
  assertWindows();
  const selected = item?.profile ?? (await pickProfile(services.profiles));
  await services.profiles.withProfileOperation(selected.id, (profile) =>
    initializeProfile(profile, services),
  );
}

async function initializeProfile(
  initialProfile: ServerProfile,
  services: HostCommandServices,
): Promise<void> {
  let profile = initialProfile;
  const approved = await vscode.window.showWarningMessage(
    vscode.l10n.t(
      'Initialize {0}? SSH Onboard will update its local SSH files, add one Include line to the selected SSH config, and append a public key to the remote user authorized_keys file.',
      profile.name,
    ),
    { modal: true },
    vscode.l10n.t('Review host fingerprint'),
  );
  if (approved === undefined) {
    throw new vscode.CancellationError();
  }

  const settings = readRemoteSshSettings();
  const tools = await services.openssh.discover(settings.sshPath);
  const paths = services.sshConfig.resolvePaths(settings.configFile);
  const localKey = await services.keys.prepare(profile, tools);
  const observation = await services.bootstrap.probeHostKey(profile);
  const trustedHostKey = await confirmHostKey(profile, observation);
  const profileWithoutError = omitProperties(profile, [
    'lastErrorCode',
    'lastVerifiedAt',
    'verificationContext',
  ]);
  profile = {
    ...profileWithoutError,
    localKey,
    trustedHostKey,
  };
  await services.profiles.update(profile);
  try {
    await services.sshConfig.persistKnownHosts(services.profiles.list(), paths);
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
    client = await services.bootstrap.connectWithPassword(profile, password, trustedHostKey);
    const plan =
      profile.pendingAuthorization ??
      createDeploymentPlan(localKey.publicKeyLine, profile.id, randomUUID());
    if (profile.pendingAuthorization === undefined) {
      profile = { ...profile, pendingAuthorization: plan };
      await services.profiles.update(profile);
    }
    const layout = await services.remoteLayout.probe(client);
    const sftp = await openSftp(client);
    const authorization = await services.authorizedKeys.deploy(sftp, localKey, layout, plan);
    sftp.end();
    const profileWithoutPending = omitProperties(profile, ['pendingAuthorization']);
    profile = {
      ...profileWithoutPending,
      authorization,
      resolvedHome: layout.home,
    };
    await services.profiles.update(profile);
  } catch (error: unknown) {
    await recordFailure(services, profile, error);
    throw error;
  } finally {
    client?.end();
  }

  profile = await applyVerifyAndPersist(profile, services, tools, paths);
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
  await services.profiles.withProfileOperation(selected.id, (profile) =>
    testProfileConnection(profile, services),
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
  await services.profiles.withProfileOperation(selected.id, (profile) =>
    connectProfile(profile, services),
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
  await services.profiles.withProfileOperation(selected.id, (profile) =>
    revokeProfileKey(profile, services),
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
    services.tree.refresh();
  } finally {
    client.end();
  }
}

async function confirmHostKey(
  profile: ServerProfile,
  observation: {
    readonly algorithm: string;
    readonly fingerprint: string;
    readonly keyBase64: string;
  },
): Promise<TrustedHostKey> {
  const existing = profile.trustedHostKey;
  if (
    existing !== undefined &&
    existing.algorithm === observation.algorithm &&
    existing.fingerprint === observation.fingerprint &&
    existing.keyBase64 === observation.keyBase64
  ) {
    return existing;
  }
  const changed = existing !== undefined;
  const endpoint = `${profile.host}:${String(profile.port)}`;
  const message = changed
    ? vscode.l10n.t(
        'The host key for {0} changed. Old: {1}. New: {2}. Replace it only after independent verification.',
        endpoint,
        existing.fingerprint,
        observation.fingerprint,
      )
    : vscode.l10n.t(
        'Host: {0}\nHost key algorithm: {1}\nFingerprint: {2}\nConfirm only after checking it through an independent channel.',
        endpoint,
        observation.algorithm,
        observation.fingerprint,
      );
  const button = vscode.l10n.t('Enter independently verified fingerprint');
  const accepted = await vscode.window.showWarningMessage(message, { modal: true }, button);
  if (accepted === undefined) {
    throw new DomainError(changed ? 'HOST_KEY_CHANGED' : 'HOST_KEY_UNTRUSTED');
  }
  const typed = await vscode.window.showInputBox({
    title: vscode.l10n.t('Verify SSH host fingerprint'),
    prompt: vscode.l10n.t('Paste the expected SHA256 fingerprint from an independent source.'),
    ignoreFocusOut: true,
    validateInput: (value) =>
      value.trim() === observation.fingerprint
        ? undefined
        : vscode.l10n.t('The fingerprint does not match.'),
  });
  if (typed?.trim() !== observation.fingerprint) {
    throw new DomainError(changed ? 'HOST_KEY_CHANGED' : 'HOST_KEY_UNTRUSTED');
  }
  return {
    ...observation,
    knownHostsHost: knownHostsAddress(profile.host, profile.port),
    trustedAt: new Date().toISOString(),
  };
}

async function applyVerifyAndPersist(
  profile: ServerProfile,
  services: HostCommandServices,
  tools: Awaited<ReturnType<WindowsOpenSsh['discover']>>,
  paths: SshConfigPaths,
): Promise<ServerProfile> {
  const safeProfile = requireLocalKeyAndTrust(profile);
  try {
    await services.sshConfig.apply(services.profiles.list(), safeProfile, tools, paths);
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
