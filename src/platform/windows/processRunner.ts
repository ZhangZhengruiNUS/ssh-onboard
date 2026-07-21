import { spawn } from 'node:child_process';

import { DomainError, type DomainErrorCode } from '../../core/domainError';

export interface ProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly nonSecretInput?: string;
  readonly timeoutMs?: number;
  readonly errorCode?: DomainErrorCode;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export class ProcessRunner {
  public run(request: ProcessRequest): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(request.executable, [...request.args], {
        cwd: request.cwd,
        env: process.env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      const timeout = setTimeout(() => {
        child.kill();
        reject(new DomainError(request.errorCode ?? 'UNEXPECTED', 'timeout'));
      }, request.timeoutMs ?? 15_000);

      const capture = (target: Buffer[], chunk: Buffer): void => {
        outputBytes += chunk.length;
        if (outputBytes > 1024 * 1024) {
          child.kill();
          reject(new DomainError(request.errorCode ?? 'UNEXPECTED', 'output-limit'));
          return;
        }
        target.push(chunk);
      };
      child.stdout.on('data', (chunk: Buffer) => capture(stdout, chunk));
      child.stderr.on('data', (chunk: Buffer) => capture(stderr, chunk));
      child.once('error', () => {
        clearTimeout(timeout);
        reject(new DomainError(request.errorCode ?? 'UNEXPECTED', 'spawn'));
      });
      child.once('close', (code) => {
        clearTimeout(timeout);
        resolve({
          exitCode: code ?? -1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
      });

      if (request.nonSecretInput === undefined) {
        child.stdin.end();
      } else {
        child.stdin.end(request.nonSecretInput, 'utf8');
      }
    });
  }

  public async runChecked(request: ProcessRequest): Promise<ProcessResult> {
    const result = await this.run(request);
    if (result.exitCode !== 0) {
      throw new DomainError(request.errorCode ?? 'UNEXPECTED', `exit:${String(result.exitCode)}`);
    }
    return result;
  }
}
