import { readFile, readdir } from 'node:fs/promises';

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
const previewReleaseNotes = await readFile('.github/release-notes/preview.md', 'utf8');
const stableReleaseNotes = await readFile('.github/release-notes/stable.md', 'utf8');

if (manifest.name !== 'ssh-onboard' || manifest.publisher !== 'ZhangZhengruiNUS') {
  fail('extension identity does not match the approved project identity');
}
if (JSON.stringify(manifest.extensionKind) !== JSON.stringify(['ui'])) {
  fail('extensionKind must remain UI-only');
}
if (manifest.extensionDependencies !== undefined) {
  fail('Remote - SSH must remain a soft dependency');
}
if (JSON.stringify(manifest.dependencies) !== JSON.stringify({ ssh2: '1.17.0' })) {
  fail('ssh2 1.17.0 must remain the only runtime dependency');
}
if (manifest.activationEvents?.some((event) => event === '*' || event === 'onStartupFinished')) {
  fail('eager activation is forbidden');
}
if (manifest.capabilities?.untrustedWorkspaces?.supported !== true) {
  fail('untrusted workspace support must be explicit');
}

for (const [name, template] of [
  ['preview', previewReleaseNotes],
  ['stable', stableReleaseNotes],
]) {
  for (const required of [
    '{{VERSION}}',
    '{{GENERATED_NOTES}}',
    '## Supported scope',
    '## Install',
    '## Verify the download',
  ]) {
    if (!template.includes(required)) {
      fail(`${name} release notes are missing ${required}`);
    }
  }
}
for (const limitation of [
  'One-time password bootstrap has not yet completed',
  'Public-key deployment to a real Linux',
  'Opening the configured default folder through the official Remote - SSH',
]) {
  if (!previewReleaseNotes.includes(limitation)) {
    fail(`preview release notes are missing limitation: ${limitation}`);
  }
}

const englishKeys = Object.keys(manifestEnglish).sort();
const chineseKeys = Object.keys(manifestChinese).sort();
if (JSON.stringify(englishKeys) !== JSON.stringify(chineseKeys)) {
  fail('manifest localization key sets differ');
}

const sourceFiles = (await readdir('src', { recursive: true }))
  .filter((file) => file.endsWith('.ts'))
  .sort();
const runtimeKeys = [];
for (const sourceFile of sourceFiles) {
  const source = await readFile(`src/${sourceFile.replaceAll('\\', '/')}`, 'utf8');
  runtimeKeys.push(
    ...[...source.matchAll(/vscode\.l10n\.t\(\s*'([^']+)'/gu)].map((match) =>
      match[1]?.replaceAll('\\n', '\n'),
    ),
  );
}
for (const key of runtimeKeys) {
  if (key !== undefined && runtimeChinese[key] === undefined) {
    fail(`missing Simplified Chinese runtime localization: ${key}`);
  }
}

globalThis.console.log('Project verification passed');
