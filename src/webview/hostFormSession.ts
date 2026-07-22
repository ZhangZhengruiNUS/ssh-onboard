import { createHash, randomUUID } from 'node:crypto';

import type { ServerProfile } from '../domain/profiles';

const TOKEN_LIFETIME_MS = 10 * 60 * 1000;

interface ExistingKeySelection {
  readonly token: string;
  readonly privateKeyPath: string;
  readonly panelId: string;
  readonly profileId: string | undefined;
  readonly revision: string;
  readonly expiresAt: number;
  used: boolean;
}

export class HostFormSessionError extends Error {
  public constructor(
    public readonly reason:
      | 'no-session'
      | 'stale-revision'
      | 'stale-profile'
      | 'invalid-token'
      | 'expired-token'
      | 'replayed-token',
  ) {
    super(`Host form session rejected: ${reason}`);
    this.name = 'HostFormSessionError';
  }
}

export class HostFormSession {
  private revision: string | undefined;
  private profileId: string | undefined;
  private snapshotHash: string | undefined;
  private readonly selections = new Map<string, ExistingKeySelection>();

  public constructor(
    public readonly panelId: string = randomUUID(),
    private readonly now: () => number = Date.now,
  ) {}

  public start(profile?: ServerProfile): string {
    this.revision = randomUUID();
    this.profileId = profile?.id;
    this.snapshotHash = profile === undefined ? undefined : profileSnapshot(profile);
    this.selections.clear();
    return this.revision;
  }

  public assertRevision(revision: string): void {
    if (this.revision === undefined) {
      throw new HostFormSessionError('no-session');
    }
    if (revision !== this.revision) {
      throw new HostFormSessionError('stale-revision');
    }
  }

  public assertProfile(profile: ServerProfile): void {
    if (
      this.profileId !== profile.id ||
      this.snapshotHash === undefined ||
      this.snapshotHash !== profileSnapshot(profile)
    ) {
      throw new HostFormSessionError('stale-profile');
    }
  }

  public createExistingKeySelection(revision: string, privateKeyPath: string): string {
    this.assertRevision(revision);
    const token = randomUUID();
    this.selections.set(token, {
      token,
      privateKeyPath,
      panelId: this.panelId,
      profileId: this.profileId,
      revision,
      expiresAt: this.now() + TOKEN_LIFETIME_MS,
      used: false,
    });
    return token;
  }

  public inspectExistingKeySelection(revision: string, token: string): string {
    this.assertRevision(revision);
    const selection = this.selections.get(token);
    if (
      selection === undefined ||
      selection.panelId !== this.panelId ||
      selection.profileId !== this.profileId ||
      selection.revision !== revision
    ) {
      throw new HostFormSessionError('invalid-token');
    }
    if (selection.used) {
      throw new HostFormSessionError('replayed-token');
    }
    if (selection.expiresAt < this.now()) {
      this.selections.delete(token);
      throw new HostFormSessionError('expired-token');
    }
    return selection.privateKeyPath;
  }

  public consumeExistingKeySelection(revision: string, token: string): string {
    const privateKeyPath = this.inspectExistingKeySelection(revision, token);
    const selection = this.selections.get(token);
    if (selection === undefined) {
      throw new HostFormSessionError('invalid-token');
    }
    selection.used = true;
    return privateKeyPath;
  }

  public clear(): void {
    this.revision = undefined;
    this.profileId = undefined;
    this.snapshotHash = undefined;
    this.selections.clear();
  }
}

function profileSnapshot(profile: ServerProfile): string {
  return createHash('sha256').update(JSON.stringify(profile)).digest('hex');
}
