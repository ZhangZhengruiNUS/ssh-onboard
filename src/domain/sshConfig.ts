import path from 'node:path';

import { DomainError } from '../core/domainError';
import type { ServerProfile } from './profiles';

export interface TextFileStyle {
  readonly bom: boolean;
  readonly newline: '\n' | '\r\n';
  readonly text: string;
}

export function decodeUtf8Config(source: Buffer): TextFileStyle {
  if (source.includes(0)) {
    throw new DomainError('LOCAL_CONFIG_CONFLICT', 'unsupported-encoding');
  }
  const bom = source.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]));
  const content = bom ? source.subarray(3) : source;
  const text = content.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(content)) {
    throw new DomainError('LOCAL_CONFIG_CONFLICT', 'unsupported-encoding');
  }
  return { bom, newline: text.includes('\r\n') ? '\r\n' : '\n', text };
}

export function ensureManagedInclude(
  source: Buffer,
  managedConfigPath = 'ssh-onboard/config',
): { readonly content: Buffer; readonly changed: boolean } {
  const style = decodeUtf8Config(source);
  const lines = style.text.length === 0 ? [] : style.text.split(/\r?\n/u);
  const normalizedPath = managedConfigPath.replaceAll('\\', '/');
  if (
    normalizedPath.includes('"') ||
    normalizedPath.includes('\r') ||
    normalizedPath.includes('\n')
  ) {
    throw new DomainError('LOCAL_CONFIG_CONFLICT', 'managed-include-path');
  }
  const directive = `Include "${normalizedPath}"`;
  const isExpected = (line: string): boolean =>
    line.trim().toLowerCase() === directive.toLowerCase();
  const managedMentions = lines.filter((line) =>
    /\bInclude\b.*ssh-onboard[\\/]config/iu.test(line),
  );
  if (managedMentions.some((line) => !isExpected(line))) {
    throw new DomainError('LOCAL_CONFIG_CONFLICT', 'managed-include');
  }
  const expectedMentions = lines.filter((line) => isExpected(line));
  if (expectedMentions.length > 1) {
    throw new DomainError('LOCAL_CONFIG_CONFLICT', 'duplicate-managed-include');
  }
  if (expectedMentions.length === 1) {
    return { content: source, changed: false };
  }

  const firstDirective = lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith('#');
  });
  const insertion = firstDirective < 0 ? lines.length : firstDirective;
  lines.splice(insertion, 0, directive);
  const text = lines.join(style.newline);
  const content = Buffer.concat([
    ...(style.bom ? [Buffer.from([0xef, 0xbb, 0xbf])] : []),
    Buffer.from(text, 'utf8'),
  ]);
  return { content, changed: true };
}

export function assertNoAliasConflict(source: Buffer, aliases: readonly string[]): void {
  const { text } = decodeUtf8Config(source);
  const aliasSet = new Set(aliases.map((alias) => alias.toLowerCase()));
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*Host\s+(.+?)\s*(?:#.*)?$/iu.exec(line);
    if (match === null) {
      continue;
    }
    for (const token of match[1]?.trim().split(/\s+/u) ?? []) {
      if (!token.includes('*') && !token.includes('?') && aliasSet.has(token.toLowerCase())) {
        throw new DomainError('LOCAL_CONFIG_CONFLICT', 'alias');
      }
    }
  }
}

export function renderManagedConfig(
  profiles: readonly ServerProfile[],
  knownHostsPath: string,
): string {
  const blocks = profiles
    .filter(
      (
        profile,
      ): profile is ServerProfile &
        Required<Pick<ServerProfile, 'localKey' | 'trustedHostKey' | 'authorization'>> =>
        profile.localKey !== undefined &&
        profile.trustedHostKey !== undefined &&
        profile.authorization !== undefined,
    )
    .sort((left, right) => left.alias.localeCompare(right.alias))
    .map((profile) => {
      const identity = quoteConfigValue(normalizeWindowsPath(profile.localKey.privateKeyPath));
      const knownHosts = quoteConfigValue(normalizeWindowsPath(knownHostsPath));
      return [
        `# BEGIN ssh-onboard:${profile.id}`,
        `Host ${profile.alias}`,
        `    HostName ${profile.host}`,
        `    User ${profile.username}`,
        `    Port ${String(profile.port)}`,
        '    IdentityFile none',
        `    IdentityFile ${identity}`,
        '    IdentitiesOnly yes',
        '    IdentityAgent none',
        '    CertificateFile none',
        '    PreferredAuthentications publickey',
        '    PasswordAuthentication no',
        '    KbdInteractiveAuthentication no',
        '    BatchMode yes',
        `    UserKnownHostsFile ${knownHosts}`,
        '    GlobalKnownHostsFile none',
        '    StrictHostKeyChecking yes',
        '    UpdateHostKeys no',
        '    CheckHostIP no',
        '    ProxyCommand none',
        '    ProxyJump none',
        `    HostKeyAlias ssh-onboard-${profile.id}`,
        '    CanonicalizeHostname no',
        '    PermitLocalCommand no',
        '    LocalCommand none',
        '    KnownHostsCommand none',
        '    ControlMaster no',
        '    ControlPath none',
        `# END ssh-onboard:${profile.id}`,
      ].join('\n');
    });
  return blocks.length === 0 ? '' : `${blocks.join('\n\n')}\n`;
}

export function renderKnownHosts(profiles: readonly ServerProfile[]): string {
  const lines = profiles
    .filter(
      (profile): profile is ServerProfile & Required<Pick<ServerProfile, 'trustedHostKey'>> =>
        profile.trustedHostKey !== undefined,
    )
    .sort((left, right) => left.alias.localeCompare(right.alias))
    .map(
      (profile) =>
        `ssh-onboard-${profile.id} ${profile.trustedHostKey.algorithm} ${profile.trustedHostKey.keyBase64}`,
    );
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

export function parseExpandedSshConfig(output: string): ReadonlyMap<string, readonly string[]> {
  const values = new Map<string, string[]>();
  for (const line of output.split(/\r?\n/u)) {
    const separator = line.indexOf(' ');
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).toLowerCase();
    const value = line.slice(separator + 1).trim();
    const current = values.get(key) ?? [];
    current.push(value);
    values.set(key, current);
  }
  return values;
}

export function assertExpandedConfig(
  output: string,
  profile: ServerProfile & Required<Pick<ServerProfile, 'localKey'>>,
  knownHostsPath: string,
): void {
  const config = parseExpandedSshConfig(output);
  const identityFiles = (config.get('identityfile') ?? []).filter((value) => value !== 'none');
  const expectedIdentity = normalizeWindowsPath(profile.localKey.privateKeyPath).toLowerCase();
  const actualIdentity = identityFiles.map((value) => unquote(value).toLowerCase());
  const expectedKnownHosts = normalizeWindowsPath(knownHostsPath).toLowerCase();
  const first = (key: string): string | undefined => config.get(key)?.[0]?.toLowerCase();
  const failures: string[] = [];
  const expect = (key: string, actual: string | undefined, expected: string): void => {
    if (actual !== expected) {
      failures.push(key);
    }
  };
  const expectNone = (key: string): void => {
    const actual = first(key);
    if (actual !== undefined && actual !== 'none') {
      failures.push(key);
    }
  };
  if (actualIdentity.length !== 1 || actualIdentity[0] !== expectedIdentity) {
    failures.push('identityfile');
  }
  expect('hostname', first('hostname'), profile.host.toLowerCase());
  expect('user', first('user'), profile.username.toLowerCase());
  expect('port', first('port'), String(profile.port));
  expect('identitiesonly', first('identitiesonly'), 'yes');
  expect('identityagent', first('identityagent'), 'none');
  expect('batchmode', first('batchmode'), 'yes');
  expect('passwordauthentication', first('passwordauthentication'), 'no');
  expect('kbdinteractiveauthentication', first('kbdinteractiveauthentication'), 'no');
  expect('stricthostkeychecking', first('stricthostkeychecking'), 'true');
  expect('updatehostkeys', first('updatehostkeys'), 'false');
  expectNone('proxycommand');
  expectNone('proxyjump');
  expect('hostkeyalias', first('hostkeyalias'), `ssh-onboard-${profile.id}`);
  expectNone('knownhostscommand');
  expectNone('localcommand');
  expectNone('controlpath');
  if ((config.get('certificatefile') ?? []).some((value) => value.toLowerCase() !== 'none')) {
    failures.push('certificatefile');
  }
  expect('permitlocalcommand', first('permitlocalcommand'), 'no');
  expect('controlmaster', first('controlmaster'), 'false');
  expect('canonicalizehostname', first('canonicalizehostname'), 'false');
  expect(
    'userknownhostsfile',
    (config.get('userknownhostsfile') ?? []).map((value) => unquote(value).toLowerCase())[0],
    expectedKnownHosts,
  );
  if (failures.length > 0) {
    throw new DomainError('LOCAL_CONFIG_CONFLICT', `expanded-config:${failures.join(',')}`);
  }
}

function normalizeWindowsPath(value: string): string {
  return path.normalize(value).replaceAll('\\', '/');
}

function quoteConfigValue(value: string): string {
  if (value.includes('"') || value.includes('\r') || value.includes('\n') || value.includes('\0')) {
    throw new DomainError('LOCAL_CONFIG_CONFLICT', 'path');
  }
  return `"${value}"`;
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
}
