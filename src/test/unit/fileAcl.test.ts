import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DomainError } from '../../core/domainError';
import { WindowsFileAcl } from '../../platform/windows/fileAcl';
import type { ProcessRequest, ProcessResult } from '../../platform/windows/processRunner';
import type { ProcessRunner } from '../../platform/windows/processRunner';

const windowsTest = process.platform === 'win32' ? test : test.skip;

suite('WindowsFileAcl', () => {
  windowsTest('checks but never rewrites a pre-existing managed directory', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'ssh-onboard-acl-'));
    const existing = path.join(temporary, 'ssh-onboard');
    await mkdir(existing);
    const requests: ProcessRequest[] = [];
    const runner = {
      run: (request: ProcessRequest): Promise<ProcessResult> => {
        requests.push(request);
        return Promise.resolve({ exitCode: 42, stdout: '', stderr: '' });
      },
    } as ProcessRunner;

    try {
      const acl = new WindowsFileAcl(runner);
      await assert.rejects(
        acl.ensureRestrictedDirectory(existing),
        (error: unknown) =>
          error instanceof DomainError &&
          error.code === 'KEY_GENERATION_FAILED' &&
          error.detail === 'acl:42',
      );
      assert.equal(requests.length, 1);
      const request = requests[0];
      assert.notEqual(request?.nonSecretInput, undefined);
      assert.deepEqual(JSON.parse(request?.nonSecretInput ?? '') as unknown, {
        target: existing,
        createdByUs: false,
        mode: 'check-directory',
      });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
});
