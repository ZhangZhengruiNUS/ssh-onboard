import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DomainError } from '../core/domainError';
import { isValidRemotePath, type ServerProfile } from '../domain/profiles';
import { assertExpandedConfig, renderManagedConfig } from '../domain/sshConfig';
import type { OpenSshTools } from '../platform/windows/openssh';
import type { ProcessRunner } from '../platform/windows/processRunner';
import type { SshConfigPaths } from './sshConfigService';

export interface VerificationResult {
  readonly resolvedHome: string;
  readonly verifiedAt: string;
}

export class VerificationService {
  public constructor(private readonly runner: ProcessRunner) {}

  public async verify(
    profile: ServerProfile & Required<Pick<ServerProfile, 'localKey' | 'trustedHostKey'>>,
    tools: OpenSshTools,
    paths: SshConfigPaths,
  ): Promise<VerificationResult> {
    const isolatedConfig = path.join(paths.managedDirectory, `.verify.${randomUUID()}.config`);
    await writeFile(isolatedConfig, renderManagedConfig([profile], paths.knownHosts), {
      flag: 'wx',
      mode: 0o600,
    });
    try {
      await this.assertConfig(profile, tools, isolatedConfig, paths);
      await this.assertConfig(profile, tools, paths.userConfig, paths);
      await this.verifyLogin(profile, tools, isolatedConfig);
      const homeResult = await this.runner.runChecked({
        executable: tools.ssh,
        args: ['-F', isolatedConfig, '-T', profile.alias, `printf '%s' "$HOME"`],
        timeoutMs: 20_000,
        errorCode: 'KEY_VERIFICATION_FAILED',
      });
      const resolvedHome = homeResult.stdout.trim();
      if (!isValidRemotePath(resolvedHome)) {
        throw new DomainError('KEY_VERIFICATION_FAILED', 'remote-home');
      }
      const targetPath = profile.defaultPath ?? resolvedHome;
      const directoryResult = await this.runner.run({
        executable: tools.ssh,
        args: [
          '-F',
          isolatedConfig,
          '-T',
          profile.alias,
          'IFS= read -r path && test -d "$path" && test -x "$path"',
        ],
        nonSecretInput: `${targetPath}\n`,
        timeoutMs: 20_000,
        errorCode: 'DEFAULT_PATH_INVALID',
      });
      if (directoryResult.exitCode !== 0) {
        throw new DomainError('DEFAULT_PATH_INVALID');
      }
      await this.verifyLogin(profile, tools, paths.userConfig);
      return { resolvedHome, verifiedAt: new Date().toISOString() };
    } finally {
      await unlink(isolatedConfig).catch(() => undefined);
    }
  }

  private async assertConfig(
    profile: ServerProfile & Required<Pick<ServerProfile, 'localKey' | 'trustedHostKey'>>,
    tools: OpenSshTools,
    configFile: string,
    paths: SshConfigPaths,
  ): Promise<void> {
    const expanded = await this.runner.runChecked({
      executable: tools.ssh,
      args: ['-F', configFile, '-G', profile.alias],
      timeoutMs: 10_000,
      errorCode: 'KEY_VERIFICATION_FAILED',
    });
    assertExpandedConfig(expanded.stdout, profile, paths.knownHosts);
  }

  private async verifyLogin(
    profile: ServerProfile,
    tools: OpenSshTools,
    configFile: string,
  ): Promise<void> {
    await this.runner.runChecked({
      executable: tools.ssh,
      args: ['-F', configFile, '-T', profile.alias, 'true'],
      timeoutMs: 20_000,
      errorCode: 'KEY_VERIFICATION_FAILED',
    });
  }
}
