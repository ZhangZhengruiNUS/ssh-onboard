import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface ExtensionManifest {
  readonly activationEvents?: readonly string[];
  readonly capabilities?: {
    readonly untrustedWorkspaces?: { readonly supported?: boolean };
    readonly virtualWorkspaces?: boolean;
  };
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly extensionDependencies?: readonly string[];
  readonly extensionKind?: readonly string[];
  readonly extensionPack?: readonly string[];
  readonly name?: string;
  readonly publisher?: string;
}

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), file), 'utf8')) as T;
}

suite('Extension manifest', () => {
  test('runs locally and activates lazily with only the audited SSH runtime dependency', () => {
    const manifest = readJson<ExtensionManifest>('package.json');

    assert.equal(manifest.name, 'ssh-onboard');
    assert.equal(manifest.publisher, 'ZhangZhengruiNUS');
    assert.deepEqual(manifest.extensionKind, ['ui']);
    assert.deepEqual(manifest.extensionPack, ['ms-vscode-remote.remote-ssh']);
    assert.equal(manifest.extensionDependencies, undefined);
    assert.equal(manifest.activationEvents, undefined);
    assert.deepEqual(manifest.dependencies, { ssh2: '1.17.0' });
    assert.equal(manifest.capabilities?.untrustedWorkspaces?.supported, true);
    assert.equal(manifest.capabilities?.virtualWorkspaces, true);
  });

  test('keeps English and Simplified Chinese manifest keys aligned', () => {
    const english = readJson<Record<string, string>>('package.nls.json');
    const chinese = readJson<Record<string, string>>('package.nls.zh-cn.json');

    assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
  });
});
