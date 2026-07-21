import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
if (
  typeof manifest.version !== 'string' ||
  !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest.version)
) {
  throw new Error('package.json contains an invalid extension version.');
}

await mkdir('artifacts', { recursive: true });
const output = `artifacts/ssh-onboard-${manifest.version}.vsix`;
const vscePath = fileURLToPath(new URL('../node_modules/@vscode/vsce/vsce', import.meta.url));
const result = spawnSync(process.execPath, [vscePath, 'package', '--out', output], {
  encoding: 'utf8',
  shell: false,
  stdio: 'inherit',
});

if (result.status !== 0) {
  throw new Error(`VSIX packaging failed (exit ${String(result.status)}).`);
}

globalThis.console.log(output);
