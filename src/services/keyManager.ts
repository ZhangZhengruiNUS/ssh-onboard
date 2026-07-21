import { access, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { DomainError } from '../core/domainError';
import { canonicalPublicKeyLine, parsePublicKeyLine } from '../domain/keys';
import type { LocalKeyReference, ServerProfile } from '../domain/profiles';
import type { KeyStrategy } from '../domain/profiles';
import type { WindowsFileAcl } from '../platform/windows/fileAcl';
import type { OpenSshTools } from '../platform/windows/openssh';
import type { ProcessRunner } from '../platform/windows/processRunner';

export class KeyManager {
  public constructor(
    private readonly runner: ProcessRunner,
    private readonly acl: WindowsFileAcl,
  ) {}

  public async prepare(profile: ServerProfile, tools: OpenSshTools): Promise<LocalKeyReference> {
    if (profile.localKey !== undefined) {
      await this.verifyReference(profile.localKey, tools, profile.keyStrategy.kind !== 'existing');
      return profile.localKey;
    }
    if (profile.keyStrategy.kind === 'existing') {
      return this.prepareExisting(profile, profile.keyStrategy, tools);
    }
    return this.prepareGenerated(profile, profile.keyStrategy, tools);
  }

  private async prepareGenerated(
    profile: ServerProfile,
    strategy: Exclude<KeyStrategy, { readonly kind: 'existing' }>,
    tools: OpenSshTools,
  ): Promise<LocalKeyReference> {
    const keyId = strategy.keyId;
    const keysDirectory = path.join(os.homedir(), '.ssh', 'ssh-onboard', 'keys');
    const managedDirectory = path.dirname(keysDirectory);
    const privateKeyPath = path.join(keysDirectory, `${keyId}_ed25519`);
    const publicKeyPath = `${privateKeyPath}.pub`;
    await this.acl.ensureRestrictedDirectory(managedDirectory);
    await this.acl.ensureRestrictedDirectory(keysDirectory);
    const relative = path.relative(keysDirectory, privateKeyPath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new DomainError('KEY_GENERATION_FAILED', 'managed-key-path');
    }

    const privateExists = await exists(privateKeyPath);
    const publicExists = await exists(publicKeyPath);
    if (privateExists !== publicExists) {
      throw new DomainError('KEY_GENERATION_FAILED', 'partial-keypair');
    }
    const generatedNow = !privateExists;
    if (generatedNow) {
      await this.runner.runChecked({
        executable: tools.sshKeygen,
        args: [
          '-q',
          '-t',
          'ed25519',
          '-f',
          privateKeyPath,
          '-N',
          '',
          '-C',
          `ssh-onboard:${profile.id}`,
        ],
        timeoutMs: 20_000,
        errorCode: 'KEY_GENERATION_FAILED',
      });
    }
    await this.acl.restrictPrivateKey(privateKeyPath, generatedNow);
    return this.readReference(keyId, privateKeyPath, publicKeyPath, profile.id);
  }

  private async prepareExisting(
    profile: ServerProfile,
    strategy: Extract<KeyStrategy, { readonly kind: 'existing' }>,
    tools: OpenSshTools,
  ): Promise<LocalKeyReference> {
    const privateKeyPath = strategy.privateKeyPath;
    await access(privateKeyPath).catch(() => {
      throw new DomainError('KEY_GENERATION_FAILED', 'existing-key-missing');
    });
    const configuredPublicPath = strategy.publicKeyPath;
    const siblingPublicPath = `${privateKeyPath}.pub`;
    let publicKeyPath: string | undefined;
    if (configuredPublicPath !== undefined && (await exists(configuredPublicPath))) {
      publicKeyPath = configuredPublicPath;
    } else if (await exists(siblingPublicPath)) {
      publicKeyPath = siblingPublicPath;
    }

    let publicKeyLine: string;
    if (publicKeyPath !== undefined) {
      publicKeyLine = await readFile(publicKeyPath, 'utf8');
    } else {
      const derived = await this.runner.runChecked({
        executable: tools.sshKeygen,
        args: ['-y', '-f', privateKeyPath],
        timeoutMs: 10_000,
        errorCode: 'KEY_GENERATION_FAILED',
      });
      publicKeyLine = derived.stdout;
    }
    const canonical = canonicalPublicKeyLine(publicKeyLine, `ssh-onboard:${profile.id}`);
    const parsed = parsePublicKeyLine(canonical);
    const reference: LocalKeyReference = {
      keyId: `existing:${parsed.fingerprint}`,
      privateKeyPath,
      ...(publicKeyPath === undefined ? {} : { publicKeyPath }),
      fingerprint: parsed.fingerprint,
      publicKeyLine: canonical,
    };
    await this.verifyReference(reference, tools, false);
    return reference;
  }

  private async readReference(
    keyId: string,
    privateKeyPath: string,
    publicKeyPath: string,
    profileId: string,
  ): Promise<LocalKeyReference> {
    const source = await readFile(publicKeyPath, 'utf8');
    const publicKeyLine = canonicalPublicKeyLine(source, `ssh-onboard:${profileId}`);
    const parsed = parsePublicKeyLine(publicKeyLine);
    return {
      keyId,
      privateKeyPath,
      publicKeyPath,
      fingerprint: parsed.fingerprint,
      publicKeyLine,
    };
  }

  private async verifyReference(
    reference: LocalKeyReference,
    tools: OpenSshTools,
    managed: boolean,
  ): Promise<void> {
    await access(reference.privateKeyPath).catch(() => {
      throw new DomainError('KEY_GENERATION_FAILED', 'private-key-missing');
    });
    if (managed) {
      await this.acl.restrictPrivateKey(reference.privateKeyPath);
    } else {
      await this.acl.assertPrivateKeySafe(reference.privateKeyPath);
    }
    const derived = await this.runner.run({
      executable: tools.sshKeygen,
      args: ['-y', '-f', reference.privateKeyPath],
      timeoutMs: 8_000,
      errorCode: 'KEY_GENERATION_FAILED',
    });
    if (derived.exitCode === 0) {
      if (parsePublicKeyLine(derived.stdout).fingerprint !== reference.fingerprint) {
        throw new DomainError('KEY_GENERATION_FAILED', 'keypair-mismatch');
      }
      return;
    }
    // V0.1 deliberately disables agent-backed encrypted keys. The generated
    // OpenSSH stanza sets IdentityAgent none so verification cannot silently
    // succeed with a different agent identity.
    throw new DomainError('KEY_GENERATION_FAILED', 'encrypted-or-unreadable-key');
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
