import { spawnSync } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { downloadAndUnzipVSCode } from '@vscode/test-electron';

if (process.platform !== 'win32') {
  throw new Error('The V0.1 VSIX smoke test must run on Windows.');
}

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const version = manifest.version;
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
  throw new Error('package.json contains an invalid extension version.');
}
const refVersion = process.env.GITHUB_REF_NAME?.replace(/^v/u, '');
if (refVersion !== undefined && refVersion !== version) {
  throw new Error('The release tag does not match the extension version.');
}

const artifactDirectory = path.resolve('artifacts');
const vsixName = `ssh-onboard-${version}.vsix`;
const artifactEntries = await readdir(artifactDirectory, { withFileTypes: true });
if (!artifactEntries.some((entry) => entry.isFile() && entry.name === vsixName)) {
  throw new Error(`Expected release asset is missing: ${vsixName}.`);
}
const vsixPath = path.join(artifactDirectory, vsixName);

const temporaryParent = path.resolve(
  process.env.RUNNER_TEMP ?? path.join(os.tmpdir(), 'ssh-onboard'),
);
await mkdir(temporaryParent, { recursive: true });
const smokeRoot = await mkdtemp(path.join(temporaryParent, 'ssh-onboard-install-smoke-'));
const userData = path.join(smokeRoot, 'user-data');
const extensions = path.join(smokeRoot, 'extensions');
const commonArguments = [`--user-data-dir=${userData}`, `--extensions-dir=${extensions}`];
const vscodeExecutable = await downloadAndUnzipVSCode({
  version: 'stable',
  platform: 'win32-x64-archive',
  cachePath: path.join(temporaryParent, 'vscode-download-cache'),
});
const vscodeRoot = path.dirname(vscodeExecutable);
const cliCandidates = [];
for (const entry of await readdir(vscodeRoot, { withFileTypes: true })) {
  if (!entry.isDirectory()) {
    continue;
  }
  const candidate = path.join(vscodeRoot, entry.name, 'resources', 'app', 'out', 'cli.js');
  try {
    await access(candidate);
    cliCandidates.push(candidate);
  } catch {
    // Other VS Code directories are not CLI runtimes.
  }
}
if (cliCandidates.length !== 1) {
  throw new Error(
    `Expected exactly one VS Code CLI runtime, found ${String(cliCandidates.length)}.`,
  );
}

const runCli = (arguments_) => {
  const result = spawnSync(vscodeExecutable, [cliCandidates[0], ...arguments_], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' },
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `VS Code CLI failed with exit ${String(result.status)}: ${result.stderr || result.error?.name || 'unknown'}`,
    );
  }
  return result.stdout;
};

try {
  runCli([...commonArguments, '--install-extension', vsixPath, '--force']);
  const stdout = runCli([...commonArguments, '--list-extensions', '--show-versions']);
  const installed = stdout
    .split(/\r?\n/u)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  const expected = `zhangzhengruinus.ssh-onboard@${version}`;
  if (!installed.includes(expected)) {
    throw new Error(`Installed extension mismatch: ${expected}.`);
  }
  globalThis.console.log(`Installed ${expected} in an isolated VS Code profile.`);
} finally {
  await rm(smokeRoot, { recursive: true, force: true });
}
