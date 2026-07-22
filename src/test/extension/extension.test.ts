import * as assert from 'node:assert/strict';

import * as vscode from 'vscode';

import { addHost } from '../../commands/profileCommands';
import { DomainError } from '../../core/domainError';
import { ProfileStore } from '../../services/profileStore';
import { readRemoteSshSettings } from '../../services/remoteSettings';
import { HostTreeDataProvider, HostTreeItem } from '../../views/hostTreeDataProvider';

suite('SSH Onboard extension', () => {
  test('activates and registers its public commands', async () => {
    const extension = vscode.extensions.getExtension('ZhangZhengruiNUS.ssh-onboard');
    assert.ok(extension);

    await extension.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.equal(extension.isActive, true);
    for (const command of [
      'sshOnboard.addHost',
      'sshOnboard.connectHost',
      'sshOnboard.editHost',
      'sshOnboard.exportProfiles',
      'sshOnboard.initializeHost',
      'sshOnboard.openSshConfig',
      'sshOnboard.refresh',
      'sshOnboard.removeHost',
      'sshOnboard.revokeKey',
      'sshOnboard.searchHosts',
      'sshOnboard.showLogs',
      'sshOnboard.showDiagnostics',
      'sshOnboard.testConnection',
    ]) {
      assert.equal(commands.includes(command), true, `${command} should be registered`);
    }
  });

  test('starts with an empty native tree view', () => {
    const provider = new HostTreeDataProvider();
    const children = provider.getChildren();

    assert.deepEqual(children, []);
  });

  test('clicking a host initializes until it is ready, then opens Remote - SSH', () => {
    const setupProfile = {
      schemaVersion: 1 as const,
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Test host',
      alias: 'test-host',
      host: '192.0.2.10',
      port: 22,
      username: 'developer',
      platform: 'linux' as const,
      keyStrategy: {
        kind: 'generated-per-host' as const,
        keyId: '00000000-0000-4000-8000-000000000002',
      },
    };
    assert.equal(new HostTreeItem(setupProfile).command?.command, 'sshOnboard.initializeHost');

    const readyProfile = {
      ...setupProfile,
      localKey: {
        keyId: setupProfile.keyStrategy.keyId,
        privateKeyPath: 'C:\\managed-key',
        fingerprint: 'SHA256:local-key',
        publicKeyLine: 'ssh-ed25519 AAAA test',
      },
      trustedHostKey: {
        algorithm: 'ssh-ed25519',
        fingerprint: 'SHA256:host-key',
        keyBase64: 'AAAA',
        knownHostsHost: '192.0.2.10',
        trustedAt: '2026-07-22T00:00:00.000Z',
      },
      authorization: {
        ownership: 'external' as const,
        fingerprint: 'SHA256:local-key',
        detectedAt: '2026-07-22T00:00:00.000Z',
      },
      lastVerifiedAt: '2026-07-22T00:00:00.000Z',
      verificationContext: {
        sshPath: 'C:\\Windows\\System32\\OpenSSH\\ssh.exe',
        configFile: 'C:\\Users\\developer\\.ssh\\config',
        keyFingerprint: 'SHA256:local-key',
        hostKeyFingerprint: 'SHA256:host-key',
      },
    };
    assert.equal(new HostTreeItem(readyProfile).command?.command, 'sshOnboard.connectHost');
  });

  test('reports a workspace-scoped Remote - SSH config setting exactly', () => {
    const configuration = {
      inspect: (key: string) =>
        key === 'configFile' ? { workspaceValue: 'workspace-config' } : undefined,
    } as Pick<vscode.WorkspaceConfiguration, 'inspect'>;
    assert.throws(
      () => readRemoteSshSettings(configuration),
      (error: unknown) =>
        error instanceof DomainError &&
        error.code === 'LOCAL_CONFIG_CONFLICT' &&
        error.detail === 'remote.SSH.configFile:workspace',
    );
  });

  test('reuses one Add Host panel and cancel does not persist a profile', async () => {
    await vscode.commands.executeCommand('sshOnboard.addHost');
    const first = await vscode.commands.executeCommand<{
      readonly open: boolean;
      readonly panelId?: string;
      readonly profileCount: number;
    }>('_sshOnboard.test.hostFormState');
    assert.equal(first.open, true);
    assert.ok(first.panelId);

    await vscode.commands.executeCommand('sshOnboard.addHost');
    const second = await vscode.commands.executeCommand<{
      readonly open: boolean;
      readonly panelId?: string;
      readonly profileCount: number;
    }>('_sshOnboard.test.hostFormState');
    assert.equal(second.panelId, first.panelId);

    await vscode.commands.executeCommand('_sshOnboard.test.cancelHostForm');
    const cancelled = await vscode.commands.executeCommand<{
      readonly open: boolean;
      readonly profileCount: number;
    }>('_sshOnboard.test.hostFormState');
    assert.equal(cancelled.open, false);
    assert.equal(cancelled.profileCount, first.profileCount);
  });

  test('saving a form draft refreshes the native tree', async () => {
    const values = new Map<string, unknown>();
    const memento = {
      get: <T>(key: string): T | undefined => values.get(key) as T | undefined,
      update: (key: string, value: unknown): Thenable<void> => {
        values.set(key, value);
        return Promise.resolve();
      },
      keys: (): readonly string[] => [...values.keys()],
    } satisfies vscode.Memento;
    const profiles = new ProfileStore(memento);
    const tree = new HostTreeDataProvider(profiles);
    let refreshes = 0;
    const disposable = tree.onDidChangeTreeData(() => {
      refreshes += 1;
    });
    try {
      await addHost(
        {
          name: 'Test host',
          host: '192.0.2.10',
          port: 22,
          username: 'developer',
          alias: 'test-host',
          keyStrategy: {
            kind: 'generated-per-host',
            keyId: '00000000-0000-4000-8000-000000000001',
          },
        },
        profiles,
        tree,
      );
      assert.equal(profiles.list().length, 1);
      assert.equal(refreshes, 1);
    } finally {
      disposable.dispose();
    }
  });
});
