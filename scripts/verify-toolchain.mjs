import process from 'node:process';

const expectedNodeMajor = 24;
const expectedNpmMajor = 11;
const actualNodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);
const npmUserAgent = process.env.npm_config_user_agent ?? '';
const actualNpmVersion = /^npm\/([^\s]+)/u.exec(npmUserAgent)?.[1];
const actualNpmMajor = Number.parseInt(actualNpmVersion?.split('.')[0] ?? '', 10);

if (actualNodeMajor !== expectedNodeMajor) {
  throw new Error(
    `Node.js ${String(expectedNodeMajor)} is required; found ${process.versions.node}.`,
  );
}

if (actualNpmMajor !== expectedNpmMajor) {
  throw new Error(
    `npm ${String(expectedNpmMajor)}.x is required; found ${actualNpmVersion ?? 'unknown'}.`,
  );
}

globalThis.console.log(
  `Toolchain verification passed (Node ${process.versions.node}, npm ${actualNpmVersion})`,
);
