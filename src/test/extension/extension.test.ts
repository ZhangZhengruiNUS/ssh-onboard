import * as assert from 'node:assert/strict';

import * as vscode from 'vscode';

import { HostTreeDataProvider } from '../../views/hostTreeDataProvider';

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
});
