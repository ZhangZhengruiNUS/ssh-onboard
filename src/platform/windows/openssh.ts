import { access } from 'node:fs/promises';
import path from 'node:path';

import { DomainError } from '../../core/domainError';
import type { ProcessRunner } from './processRunner';

export interface OpenSshTools {
  readonly ssh: string;
  readonly sshKeygen: string;
  readonly sshAdd?: string;
}

export class WindowsOpenSsh {
  public constructor(private readonly runner: ProcessRunner) {}

  public async discover(customSshPath?: string): Promise<OpenSshTools> {
    if (process.platform !== 'win32') {
      throw new DomainError('UNSUPPORTED_PLATFORM');
    }
    const ssh =
      customSshPath === undefined || customSshPath.trim().length === 0
        ? await this.findRequired('ssh.exe')
        : await this.validateCustomSsh(customSshPath.trim());
    const sshKeygen = await this.findRequired('ssh-keygen.exe');
    const sshAdd = await this.findOptional('ssh-add.exe');
    await this.runner.runChecked({
      executable: ssh,
      args: ['-V'],
      timeoutMs: 5_000,
      errorCode: 'PREREQUISITE_MISSING',
    });
    await this.runner
      .runChecked({
        executable: sshKeygen,
        args: ['-?'],
        timeoutMs: 5_000,
        errorCode: 'PREREQUISITE_MISSING',
      })
      .catch(async (error: unknown) => {
        const result = await this.runner.run({
          executable: sshKeygen,
          args: ['-?'],
          timeoutMs: 5_000,
        });
        if (result.exitCode !== 1) {
          throw error;
        }
      });
    return { ssh, sshKeygen, ...(sshAdd === undefined ? {} : { sshAdd }) };
  }

  private async validateCustomSsh(customSshPath: string): Promise<string> {
    const resolved = path.resolve(customSshPath);
    try {
      await access(resolved);
      return resolved;
    } catch {
      throw new DomainError('PREREQUISITE_MISSING', 'remote.SSH.path');
    }
  }

  private async findRequired(name: string): Promise<string> {
    const executable = await this.findOptional(name);
    if (executable === undefined) {
      throw new DomainError('PREREQUISITE_MISSING', name);
    }
    return executable;
  }

  private async findOptional(name: string): Promise<string | undefined> {
    const windowsDirectory = process.env.WINDIR;
    if (windowsDirectory !== undefined) {
      const systemPath = path.join(windowsDirectory, 'System32', 'OpenSSH', name);
      try {
        await access(systemPath);
        return systemPath;
      } catch {
        // Continue with PATH lookup.
      }
    }
    const result = await this.runner.run({
      executable: 'where.exe',
      args: [name],
      timeoutMs: 5_000,
      errorCode: 'PREREQUISITE_MISSING',
    });
    return result.exitCode === 0 ? result.stdout.split(/\r?\n/u)[0]?.trim() : undefined;
  }
}
