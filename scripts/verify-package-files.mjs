import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const expectedFiles = [
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
  'SECURITY.md',
  'SUPPORT.md',
  'THIRD_PARTY_NOTICES.md',
  'dist/extension.js',
  'l10n/bundle.l10n.zh-cn.json',
  'media/activitybar.svg',
  'media/hostForm.css',
  'media/hostForm.js',
  'media/hostKeyReview.css',
  'media/hostKeyReview.js',
  'media/host-form.png',
  'package.json',
  'package.nls.json',
  'package.nls.zh-cn.json',
].sort();

const vscePath = fileURLToPath(new URL('../node_modules/@vscode/vsce/vsce', import.meta.url));
const result = spawnSync(process.execPath, [vscePath, 'ls'], {
  encoding: 'utf8',
  shell: false,
});

if (result.status !== 0) {
  throw new Error(`Unable to inspect package files (exit ${String(result.status)}).`);
}

const actualFiles = result.stdout
  .split(/\r?\n/u)
  .map((line) => line.trim().replaceAll('\\', '/'))
  .filter(Boolean)
  .sort();

if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  const expected = expectedFiles.join(', ');
  const actual = actualFiles.join(', ');
  throw new Error(`Package file allowlist mismatch. Expected: ${expected}. Actual: ${actual}.`);
}

globalThis.console.log(`Package file allowlist passed (${String(actualFiles.length)} files)`);
