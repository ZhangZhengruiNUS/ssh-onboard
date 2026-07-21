import { readFile } from 'node:fs/promises';
import process from 'node:process';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const expectedNodeMajor = 24;
const expectedNpm = String(manifest.packageManager).replace(/^npm@/u, '');
const actualNodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
const npmUserAgent = process.env.npm_config_user_agent ?? '';
const actualNpm = /^npm\/([^\s]+)/u.exec(npmUserAgent)?.[1];

if (actualNodeMajor !== expectedNodeMajor) {
  throw new Error(
    `Node.js ${String(expectedNodeMajor)} is required; found ${process.versions.node}.`,
  );
}

if (actualNpm !== expectedNpm) {
  throw new Error(`npm ${expectedNpm} is required; found ${actualNpm ?? 'unknown'}.`);
}

globalThis.console.log(
  `Toolchain verification passed (Node ${process.versions.node}, npm ${actualNpm})`,
);
