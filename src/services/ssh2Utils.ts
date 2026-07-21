import type { Client, SFTPWrapper, Stats } from 'ssh2';

import { DomainError, type DomainErrorCode } from '../core/domainError';

export function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error !== undefined) {
        reject(new DomainError('REMOTE_LAYOUT_UNSAFE'));
      } else {
        resolve(sftp);
      }
    });
  });
}

export function execFixed(client: Client, command: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    client.exec(command, (error, stream) => {
      if (error !== undefined) {
        reject(new DomainError('REMOTE_LAYOUT_UNSAFE'));
        return;
      }
      const stdout: Buffer[] = [];
      let stdoutBytes = 0;
      let failed = false;
      stream.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > 64 * 1024) {
          failed = true;
          stream.destroy();
          reject(new DomainError('REMOTE_LAYOUT_UNSAFE', 'output-limit'));
          return;
        }
        stdout.push(chunk);
      });
      stream.stderr.resume();
      stream.once('close', (code: number | undefined) => {
        if (failed) {
          return;
        }
        if (code === 0) {
          resolve(Buffer.concat(stdout));
        } else {
          reject(new DomainError('REMOTE_LAYOUT_UNSAFE'));
        }
      });
    });
  });
}

export function sftpLstat(sftp: SFTPWrapper, remotePath: string): Promise<Stats> {
  return callbackPromise((callback) => sftp.lstat(remotePath, callback), 'REMOTE_LAYOUT_UNSAFE');
}

export function sftpTryLstat(sftp: SFTPWrapper, remotePath: string): Promise<Stats | undefined> {
  return new Promise((resolve, reject) => {
    sftp.lstat(remotePath, (error, stats) => {
      if (error === undefined) {
        resolve(stats);
      } else if (isMissingSftpError(error)) {
        resolve(undefined);
      } else {
        reject(new DomainError('REMOTE_LAYOUT_UNSAFE'));
      }
    });
  });
}

export function sftpReadFile(sftp: SFTPWrapper, remotePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    sftp.readFile(remotePath, (error, data) => {
      if (error !== undefined) {
        reject(new DomainError('REMOTE_LAYOUT_UNSAFE'));
      } else {
        resolve(Buffer.isBuffer(data) ? data : Buffer.from(data));
      }
    });
  });
}

export function sftpWriteFile(
  sftp: SFTPWrapper,
  remotePath: string,
  content: Buffer,
  mode: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.writeFile(remotePath, content, { mode, flag: 'wx' }, (error) => {
      if (error !== undefined) {
        reject(new DomainError('AUTHORIZED_KEYS_WRITE_FAILED'));
      } else {
        resolve();
      }
    });
  });
}

export async function sftpWriteFileDurable(
  sftp: SFTPWrapper,
  remotePath: string,
  content: Buffer,
  mode: number,
): Promise<void> {
  const handle = await new Promise<Buffer>((resolve, reject) => {
    sftp.open(remotePath, 'wx', { mode }, (error, opened) => {
      if (error !== undefined) {
        reject(new DomainError('AUTHORIZED_KEYS_WRITE_FAILED'));
      } else {
        resolve(opened);
      }
    });
  });
  let writeError: Error | undefined;
  try {
    for (let position = 0; position < content.length; position += 32 * 1024) {
      const length = Math.min(32 * 1024, content.length - position);
      await new Promise<void>((resolve, reject) => {
        sftp.write(handle, content, position, length, position, (error) => {
          if (error !== undefined) {
            reject(new DomainError('AUTHORIZED_KEYS_WRITE_FAILED'));
          } else {
            resolve();
          }
        });
      });
    }
    await new Promise<void>((resolve, reject) => {
      sftp.ext_openssh_fsync(handle, (error) => {
        if (error !== undefined) {
          reject(new DomainError('AUTHORIZED_KEYS_WRITE_FAILED', 'fsync'));
        } else {
          resolve();
        }
      });
    });
  } catch (error: unknown) {
    writeError = error instanceof Error ? error : new DomainError('AUTHORIZED_KEYS_WRITE_FAILED');
  }
  await new Promise<void>((resolve, reject) => {
    sftp.close(handle, (error) => {
      if (error !== undefined) {
        reject(new DomainError('AUTHORIZED_KEYS_WRITE_FAILED'));
      } else {
        resolve();
      }
    });
  }).catch((error: unknown) => {
    writeError ??= error instanceof Error ? error : new DomainError('AUTHORIZED_KEYS_WRITE_FAILED');
  });
  if (writeError !== undefined) {
    throw writeError;
  }
}

export function sftpMkdir(sftp: SFTPWrapper, remotePath: string, mode: number): Promise<void> {
  return callbackPromise(
    (callback) => sftp.mkdir(remotePath, { mode }, callback),
    'REMOTE_LAYOUT_UNSAFE',
  );
}

export function sftpChmod(sftp: SFTPWrapper, remotePath: string, mode: number): Promise<void> {
  return callbackPromise(
    (callback) => sftp.chmod(remotePath, mode, callback),
    'REMOTE_LAYOUT_UNSAFE',
  );
}

export function sftpAtomicReplace(sftp: SFTPWrapper, from: string, to: string): Promise<void> {
  return callbackPromise(
    (callback) => sftp.ext_openssh_rename(from, to, callback),
    'AUTHORIZED_KEYS_WRITE_FAILED',
  );
}

export function sftpUnlink(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return callbackPromise(
    (callback) => sftp.unlink(remotePath, callback),
    'AUTHORIZED_KEYS_WRITE_FAILED',
  );
}

export function sftpRmdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return callbackPromise(
    (callback) => sftp.rmdir(remotePath, callback),
    'AUTHORIZED_KEYS_WRITE_FAILED',
  );
}

function callbackPromise<T>(
  invoke: (callback: (error: Error | null | undefined, value: T) => void) => void,
  code: DomainErrorCode,
): Promise<T>;
function callbackPromise(
  invoke: (callback: (error?: Error | null) => void) => void,
  code: DomainErrorCode,
): Promise<void>;
function callbackPromise<T>(
  invoke: (callback: (error?: Error | null, value?: T) => void) => void,
  code: DomainErrorCode,
): Promise<T | void> {
  return new Promise((resolve, reject) => {
    invoke((error, value) => {
      if (error !== undefined && error !== null) {
        reject(new DomainError(code));
      } else {
        resolve(value);
      }
    });
  });
}

export function isMissingSftpError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === 2 || code === 'ENOENT';
}
