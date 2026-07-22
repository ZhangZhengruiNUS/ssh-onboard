import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { WindowsFileAcl } from '../../platform/windows/fileAcl';
import { DomainError } from '../../core/domainError';
import { omitProperties } from '../../core/objects';
import { WindowsOpenSsh } from '../../platform/windows/openssh';
import { ProcessRunner } from '../../platform/windows/processRunner';
import { SshConfigService } from '../../services/sshConfigService';
import type { ServerProfile } from '../../domain/profiles';

const windowsTest = process.platform === 'win32' ? test : test.skip;

suite('Windows platform integration', function () {
  this.timeout(60_000);
  windowsTest('discovers OpenSSH and writes a config that ssh -G accepts', async () => {
    const temporary = await mkdtemp(path.join(os.homedir(), 'ssh-onboard-test-'));
    try {
      const runner = new ProcessRunner();
      const acl = new WindowsFileAcl(runner);
      const openssh = new WindowsOpenSsh(runner);
      const tools = await openssh.discover();
      const service = new SshConfigService(runner, acl, 'a'.repeat(64));
      const defaultPaths = service.resolvePaths();
      assert.equal(defaultPaths.userConfig, path.join(os.homedir(), '.ssh', 'config'));
      assert.equal(defaultPaths.managedDirectory, path.join(os.homedir(), '.ssh', 'ssh-onboard'));
      const paths = service.resolvePaths(path.join(temporary, 'config'));
      const keyPath = path.join(temporary, 'test key');
      await writeFile(keyPath, 'not-used-by-ssh-g', 'utf8');
      const profile: ServerProfile = {
        schemaVersion: 1,
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Test',
        alias: 'ssh-onboard-test',
        host: '192.0.2.10',
        port: 22,
        username: 'developer',
        platform: 'linux',
        keyStrategy: {
          kind: 'generated-per-host',
          keyId: '00000000-0000-4000-8000-000000000002',
        },
        localKey: {
          keyId: '00000000-0000-4000-8000-000000000002',
          privateKeyPath: keyPath,
          fingerprint: 'SHA256:key',
          publicKeyLine: 'ssh-ed25519 AAAA test',
        },
        trustedHostKey: {
          algorithm: 'ssh-ed25519',
          fingerprint: 'SHA256:host',
          keyBase64: 'AAAA',
          knownHostsHost: '192.0.2.10',
          trustedAt: '2026-01-01T00:00:00.000Z',
        },
        authorization: {
          ownership: 'external',
          fingerprint: 'SHA256:key',
          detectedAt: '2026-01-01T00:00:00.000Z',
        },
      };

      try {
        await service.persistKnownHosts([omitProperties(profile, ['authorization'])], paths);
      } catch (error: unknown) {
        if (error instanceof DomainError) {
          const diagnostic = await runner.run({
            executable: 'powershell.exe',
            args: [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-Command',
              [
                '$target = [Console]::In.ReadToEnd()',
                '$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()',
                '$acl = Get-Acl -LiteralPath $target -ErrorAction Stop',
                '$errorCountBeforeOwner = $Error.Count',
                '$previousPreference = $ErrorActionPreference',
                "$ErrorActionPreference = 'Continue'",
                '$owner = $acl.Owner',
                '$ownerReadSucceeded = $?',
                '$ownerErrorCount = $Error.Count - $errorCountBeforeOwner',
                '$ownerError = if ($ownerErrorCount -gt 0) { $Error[0] } else { $null }',
                '$ErrorActionPreference = $previousPreference',
                '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
                '[Console]::Out.WriteLine("aclIsFileSystemSecurity=" + ($acl -is [System.Security.AccessControl.FileSystemSecurity]))',
                '[Console]::Out.WriteLine("aclType=" + [string]$acl.PSObject.BaseObject.GetType().FullName)',
                '[Console]::Out.WriteLine("owner=$owner")',
                '[Console]::Out.WriteLine("ownerReadSucceeded=$ownerReadSucceeded")',
                '[Console]::Out.WriteLine("ownerErrorCount=$ownerErrorCount")',
                'if ($null -ne $ownerError) { [Console]::Out.WriteLine("ownerErrorId=" + $ownerError.FullyQualifiedErrorId); [Console]::Out.WriteLine("ownerExceptionType=" + $ownerError.Exception.GetType().FullName); [Console]::Out.WriteLine("ownerInnerExceptionType=" + $(if ($null -ne $ownerError.Exception.InnerException) { $ownerError.Exception.InnerException.GetType().FullName } else { "" })); [Console]::Out.WriteLine("ownerHResult=" + $ownerError.Exception.HResult); [Console]::Out.WriteLine("ownerCategory=" + $ownerError.CategoryInfo.Category) }',
                '[Console]::Out.WriteLine("current=" + $identity.User.Value)',
              ].join('; '),
            ],
            nonSecretInput: paths.managedDirectory,
            errorCode: 'KEY_GENERATION_FAILED',
          });
          throw new Error(
            `${error.code}:${error.detail ?? 'no-detail'}:${diagnostic.stdout.trim()}`,
            { cause: error },
          );
        }
        throw error;
      }
      await acl.assertDirectorySafe(paths.managedDirectory);
      await Promise.all([
        acl.assertManagedFileSafe(paths.managedConfig),
        acl.assertManagedFileSafe(paths.knownHosts),
        acl.assertManagedFileSafe(paths.managedState),
      ]);
      assert.match(await readFile(paths.knownHosts, 'utf8'), /^ssh-onboard-/u);
      await assert.rejects(readFile(paths.userConfig), { code: 'ENOENT' });
      assert.equal(await readFile(paths.managedConfig, 'utf8'), '');
      assert.match(await readFile(paths.managedState, 'utf8'), /"schemaVersion":1/u);

      await service.apply(
        [profile],
        profile as ServerProfile & Required<Pick<ServerProfile, 'localKey'>>,
        tools,
        paths,
      );
      await service.apply(
        [profile],
        profile as ServerProfile & Required<Pick<ServerProfile, 'localKey'>>,
        tools,
        paths,
      );
      const userConfig = await readFile(paths.userConfig, 'utf8');
      assert.match(userConfig, /^Include ".*ssh-onboard\/config"/u);

      const editedProfile = { ...profile, alias: 'ssh-onboard-test-edited' };
      await service.synchronize([editedProfile], paths);
      const editedManagedConfig = await readFile(paths.managedConfig, 'utf8');
      assert.match(editedManagedConfig, /Host ssh-onboard-test-edited/u);
      assert.doesNotMatch(editedManagedConfig, /Host ssh-onboard-test(?:\r?\n)/u);

      const generatedKey = path.join(temporary, 'generated key');
      await runner.runChecked({
        executable: tools.sshKeygen,
        args: ['-q', '-t', 'ed25519', '-f', generatedKey, '-N', '', '-C', 'ssh-onboard-test'],
        errorCode: 'KEY_GENERATION_FAILED',
      });
      await acl.restrictPrivateKey(generatedKey, true);
      await acl.assertPrivateKeySafe(generatedKey);
      const derived = await runner.runChecked({
        executable: tools.sshKeygen,
        args: ['-y', '-f', generatedKey],
        errorCode: 'KEY_GENERATION_FAILED',
      });
      assert.match(derived.stdout, /^ssh-ed25519 /u);

      const managedConfig = await readFile(paths.managedConfig, 'utf8');
      await writeFile(paths.managedConfig, `${managedConfig}# external edit\n`, 'utf8');
      await assert.rejects(
        service.apply(
          [profile],
          profile as ServerProfile & Required<Pick<ServerProfile, 'localKey'>>,
          tools,
          paths,
        ),
        (error: unknown) =>
          error instanceof DomainError && error.detail === 'managed-config-external-change',
      );
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
