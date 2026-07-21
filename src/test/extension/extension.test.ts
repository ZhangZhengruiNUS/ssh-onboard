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
    assert.equal(commands.includes('sshOnboard.addHost'), true);
    assert.equal(commands.includes('sshOnboard.showLogs'), true);
  });

  test('starts with an empty native tree view', async () => {
    const provider = new HostTreeDataProvider();
    const children = await provider.getChildren();

    assert.deepEqual(children, []);
  });
});
