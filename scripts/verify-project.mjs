import { readFile } from 'node:fs/promises';

function fail(message) {
  throw new Error(`Project verification failed: ${message}`);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

const manifest = await readJson('package.json');
const manifestEnglish = await readJson('package.nls.json');
const manifestChinese = await readJson('package.nls.zh-cn.json');
const runtimeChinese = await readJson('l10n/bundle.l10n.zh-cn.json');
const extensionSource = await readFile('src/extension.ts', 'utf8');

if (manifest.name !== 'ssh-onboard' || manifest.publisher !== 'ZhangZhengruiNUS') {
  fail('extension identity does not match the approved project identity');
}
if (JSON.stringify(manifest.extensionKind) !== JSON.stringify(['ui'])) {
  fail('extensionKind must remain UI-only');
}
if (manifest.extensionDependencies !== undefined) {
  fail('Remote - SSH must remain a soft dependency');
}
if (manifest.dependencies !== undefined && Object.keys(manifest.dependencies).length > 0) {
  fail('Phase 1 must not contain runtime dependencies');
}
if (manifest.activationEvents?.some((event) => event === '*' || event === 'onStartupFinished')) {
  fail('eager activation is forbidden');
}
if (manifest.capabilities?.untrustedWorkspaces?.supported !== true) {
  fail('untrusted workspace support must be explicit');
}

const englishKeys = Object.keys(manifestEnglish).sort();
const chineseKeys = Object.keys(manifestChinese).sort();
if (JSON.stringify(englishKeys) !== JSON.stringify(chineseKeys)) {
  fail('manifest localization key sets differ');
}

const runtimeKeys = [...extensionSource.matchAll(/vscode\.l10n\.t\(\s*'([^']+)'/gu)].map(
  (match) => match[1],
);
for (const key of runtimeKeys) {
  if (key !== undefined && runtimeChinese[key] === undefined) {
    fail(`missing Simplified Chinese runtime localization: ${key}`);
  }
}

globalThis.console.log('Project verification passed');
