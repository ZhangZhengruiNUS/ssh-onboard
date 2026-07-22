import * as assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DomainError } from '../../core/domainError';
import { renderKnownHosts, renderManagedConfig } from '../../domain/sshConfig';
import type { ServerProfile } from '../../domain/profiles';
import type { WindowsFileAcl } from '../../platform/windows/fileAcl';
import type { ProcessRunner } from '../../platform/windows/processRunner';
import { SshConfigService, type SshConfigPaths } from '../../services/sshConfigService';

const trustedProfile: ServerProfile = {
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Test',
  alias: 'test-host',
  host: '192.0.2.10',
  port: 22,
  username: 'developer',
  platform: 'linux',
  keyStrategy: {
    kind: 'generated-per-host',
    keyId: '00000000-0000-4000-8000-000000000002',
  },
  trustedHostKey: {
    algorithm: 'ssh-ed25519',
    fingerprint: 'SHA256:host',
    keyBase64: 'AAAA',
    knownHostsHost: '192.0.2.10',
    trustedAt: '2026-01-01T00:00:00.000Z',
  },
};

function createService(
  restrictPrivateKey: (filePath: string) => Promise<void> = () => Promise.resolve(),
  authorityHash = 'a'.repeat(64),
): SshConfigService {
  const runner = {
    run: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
  } as unknown as ProcessRunner;
  const acl = {
    ensureRestrictedDirectory: (directory: string) => mkdir(directory, { recursive: true }),
    assertDirectorySafe: () => Promise.resolve(),
    assertManagedFileSafe: () => Promise.resolve(),
    restrictPrivateKey,
  } as unknown as WindowsFileAcl;
  return new SshConfigService(runner, acl, authorityHash);
}

function pathsFor(service: SshConfigService, temporary: string): SshConfigPaths {
  return service.resolvePaths(path.join(temporary, 'config'));
}

suite('SshConfigService managed state', () => {
  test('checks a projected form alias without creating managed files', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'ssh-onboard-form-alias-'));
    try {
      const service = createService();
      const paths = pathsFor(service, temporary);
      await writeFile(paths.userConfig, 'Host occupied\n    User developer\n', 'utf8');

      await assert.rejects(
        service.preflightAlias(() => [], paths, { id: 'draft', alias: 'occupied' }),
        (error: unknown) =>
          error instanceof DomainError &&
          error.code === 'LOCAL_CONFIG_CONFLICT' &&
          error.detail === 'alias',
      );
      await assert.rejects(stat(paths.managedDirectory), { code: 'ENOENT' });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test('commits empty config, known_hosts, and V1 state without touching user config', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'ssh-onboard-config-'));
    try {
      const service = createService();
      const paths = pathsFor(service, temporary);
      await service.persistKnownHosts(() => [trustedProfile], paths);

      assert.equal(await readFile(paths.managedConfig, 'utf8'), '');
      assert.equal(await readFile(paths.knownHosts, 'utf8'), renderKnownHosts([trustedProfile]));
      assert.match(await readFile(paths.managedState, 'utf8'), /"schemaVersion":1/u);
      await assert.rejects(stat(paths.userConfig), { code: 'ENOENT' });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test('recognizes and repairs only the exact Preview.2 residue', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'ssh-onboard-preview2-'));
    try {
      const service = createService();
      const paths = pathsFor(service, temporary);
      await mkdir(paths.managedDirectory, { recursive: true });
      const knownHosts = renderKnownHosts([trustedProfile]);
      await writeFile(paths.knownHosts, knownHosts, 'utf8');

      assert.deepEqual(await service.preflight(() => [trustedProfile], paths), {
        ok: true,
        recovery: 'preview-2',
      });
      await assert.rejects(stat(paths.managedConfig), { code: 'ENOENT' });
      await assert.rejects(stat(paths.managedState), { code: 'ENOENT' });

      await service.persistKnownHosts(() => [trustedProfile], paths);
      assert.equal(await readFile(paths.managedConfig, 'utf8'), '');
      assert.equal(await readFile(paths.knownHosts, 'utf8'), knownHosts);
      assert.match(await readFile(paths.managedState, 'utf8'), /"knownHostsHash"/u);
      await assert.rejects(stat(paths.userConfig), { code: 'ENOENT' });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test('claims a legacy V1 state only when both files match the current authority projection', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'ssh-onboard-legacy-state-'));
    try {
      const service = createService();
      const paths = pathsFor(service, temporary);
      await mkdir(paths.managedDirectory, { recursive: true });
      const managedConfig = Buffer.alloc(0);
      const knownHosts = Buffer.from(renderKnownHosts([trustedProfile]), 'utf8');
      await writeFile(paths.managedConfig, managedConfig);
      await writeFile(paths.knownHosts, knownHosts);
      await writeFile(
        paths.managedState,
        `${JSON.stringify({
          schemaVersion: 1,
          managedConfigHash: createHash('sha256').update(managedConfig).digest('hex'),
          knownHostsHash: createHash('sha256').update(knownHosts).digest('hex'),
        })}\n`,
        'utf8',
      );

      await service.persistKnownHosts(() => [trustedProfile], paths);
      assert.match(await readFile(paths.managedState, 'utf8'), /"authorityHash":"a{64}"/u);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test('does not claim an ownerless non-Preview.2 interrupted layout', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'ssh-onboard-first-trust-'));
    try {
      const service = createService();
      const paths = pathsFor(service, temporary);
      await mkdir(paths.managedDirectory, { recursive: true });
      await writeFile(paths.managedConfig, '', 'utf8');

      await assert.rejects(
        service.preflight(() => [trustedProfile], paths),
        (error: unknown) => error instanceof DomainError && error.detail === 'managed-state',
      );
      assert.equal(await readFile(paths.managedConfig, 'utf8'), '');
      await assert.rejects(stat(paths.knownHosts), { code: 'ENOENT' });
      await assert.rejects(stat(paths.managedState), { code: 'ENOENT' });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test('rejects an unknown one-byte difference without writing any file', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'ssh-onboard-difference-'));
    try {
      const service = createService();
      const paths = pathsFor(service, temporary);
      await mkdir(paths.managedDirectory, { recursive: true });
      const changed = `${renderKnownHosts([trustedProfile])}#`;
      await writeFile(paths.knownHosts, changed, 'utf8');

      await assert.rejects(
        service.preflight(() => [trustedProfile], paths),
        (error: unknown) =>
          error instanceof DomainError &&
          error.code === 'LOCAL_CONFIG_CONFLICT' &&
          error.detail === 'managed-state',
      );
      assert.equal(await readFile(paths.knownHosts, 'utf8'), changed);
      await assert.rejects(stat(paths.managedConfig), { code: 'ENOENT' });
      await assert.rejects(stat(paths.managedState), { code: 'ENOENT' });
      await assert.rejects(stat(paths.userConfig), { code: 'ENOENT' });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test('does not recreate a missing non-empty managed config', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'ssh-onboard-missing-config-'));
    try {
      const service = createService();
      const paths = pathsFor(service, temporary);
      const authorized: ServerProfile = {
        ...trustedProfile,
        localKey: {
          keyId: '00000000-0000-4000-8000-000000000002',
          privateKeyPath: path.join(temporary, 'key'),
          fingerprint: 'SHA256:key',
          publicKeyLine: 'ssh-ed25519 BBBB test',
        },
        authorization: {
          ownership: 'external',
          fingerprint: 'SHA256:key',
          detectedAt: '2026-01-01T00:00:00.000Z',
        },
      };
      assert.notEqual(renderManagedConfig([authorized], paths.knownHosts), '');
      await mkdir(paths.managedDirectory, { recursive: true });
      await writeFile(paths.knownHosts, renderKnownHosts([authorized]), 'utf8');

      await assert.rejects(
        service.preflight(() => [authorized], paths),
        (error: unknown) => error instanceof DomainError && error.detail === 'managed-state',
      );
      await assert.rejects(stat(paths.managedConfig), { code: 'ENOENT' });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test('checks aliases only for active or projected managed Host blocks', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'ssh-onboard-alias-'));
    try {
      const service = createService();
      const paths = pathsFor(service, temporary);
      await writeFile(paths.userConfig, 'Host test-host\n    HostName 192.0.2.20\n', 'utf8');

      assert.deepEqual(await service.preflight(() => [trustedProfile], paths), {
        ok: true,
        recovery: 'none',
      });
      await assert.rejects(
        service.preflight(() => [trustedProfile], paths, {
          id: trustedProfile.id,
          alias: trustedProfile.alias,
        }),
        (error: unknown) => error instanceof DomainError && error.detail === 'alias',
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test('converges after an interrupted managed config or Include rename', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'ssh-onboard-interrupted-'));
    try {
      const service = createService();
      const paths = pathsFor(service, temporary);
      await service.persistKnownHosts(() => [trustedProfile], paths);
      const authorized: ServerProfile = {
        ...trustedProfile,
        localKey: {
          keyId: '00000000-0000-4000-8000-000000000002',
          privateKeyPath: path.join(temporary, 'key'),
          fingerprint: 'SHA256:key',
          publicKeyLine: 'ssh-ed25519 BBBB test',
        },
        authorization: {
          ownership: 'external',
          fingerprint: 'SHA256:key',
          detectedAt: '2026-01-01T00:00:00.000Z',
        },
      };
      const managed = renderManagedConfig([authorized], paths.knownHosts);
      await writeFile(paths.managedConfig, managed, 'utf8');
      await writeFile(
        paths.userConfig,
        `Include "${paths.managedConfig.replaceAll('\\', '/')}"`,
        'utf8',
      );

      await service.synchronize(() => [authorized], paths);
      assert.equal(await readFile(paths.managedConfig, 'utf8'), managed);
      assert.equal(await readFile(paths.knownHosts, 'utf8'), renderKnownHosts([authorized]));
      assert.match(await readFile(paths.managedState, 'utf8'), /"managedConfigHash"/u);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test('rolls back all earlier renames when the state commit fails', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'ssh-onboard-state-failure-'));
    let failStateCommit = false;
    try {
      const service = createService((filePath) => {
        if (failStateCommit && path.basename(filePath).startsWith('state.json.tmp.')) {
          return Promise.reject(new Error('injected state failure'));
        }
        return Promise.resolve();
      });
      const paths = pathsFor(service, temporary);
      await service.persistKnownHosts(() => [trustedProfile], paths);
      const stateBefore = await readFile(paths.managedState);
      const knownHostsBefore = await readFile(paths.knownHosts);
      const managedConfigBefore = await readFile(paths.managedConfig);
      const authorized: ServerProfile = {
        ...trustedProfile,
        localKey: {
          keyId: '00000000-0000-4000-8000-000000000002',
          privateKeyPath: path.join(temporary, 'key'),
          fingerprint: 'SHA256:key',
          publicKeyLine: 'ssh-ed25519 BBBB test',
        },
        authorization: {
          ownership: 'external',
          fingerprint: 'SHA256:key',
          detectedAt: '2026-01-01T00:00:00.000Z',
        },
      };

      failStateCommit = true;
      await assert.rejects(
        service.synchronize(() => [authorized], paths),
        (error: unknown) => error instanceof DomainError && error.code === 'LOCAL_CONFIG_CONFLICT',
      );
      assert.deepEqual(await readFile(paths.managedState), stateBefore);
      assert.deepEqual(await readFile(paths.knownHosts), knownHostsBefore);
      assert.deepEqual(await readFile(paths.managedConfig), managedConfigBefore);
      await assert.rejects(stat(paths.userConfig), { code: 'ENOENT' });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });

  test('does not let another ProfileStore authority replace managed files', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'ssh-onboard-authority-'));
    try {
      const first = createService(() => Promise.resolve(), 'a'.repeat(64));
      const second = createService(() => Promise.resolve(), 'b'.repeat(64));
      const paths = pathsFor(first, temporary);
      await first.persistKnownHosts(() => [trustedProfile], paths);
      const before = await readFile(paths.knownHosts);
      const other: ServerProfile = {
        ...trustedProfile,
        id: '00000000-0000-4000-8000-000000000003',
        alias: 'other-host',
        host: '192.0.2.20',
      };

      await assert.rejects(
        second.persistKnownHosts(() => [other], paths),
        (error: unknown) => error instanceof DomainError && error.detail === 'managed-state-owner',
      );
      assert.deepEqual(await readFile(paths.knownHosts), before);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
