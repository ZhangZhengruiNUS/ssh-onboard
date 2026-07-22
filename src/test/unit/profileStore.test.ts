import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type * as vscode from 'vscode';

import { DomainError } from '../../core/domainError';
import type { ProfileDraft } from '../../domain/profiles';
import { ProfileStore } from '../../services/profileStore';

class MemoryMemento implements vscode.Memento {
  private readonly values = new Map<string, unknown>();

  public constructor(private readonly afterUpdate?: () => void | Promise<void>) {}

  public keys(): readonly string[] {
    return [...this.values.keys()];
  }

  public get<T>(key: string): T | undefined;
  public get<T>(key: string, defaultValue: T): T;
  public get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.get(key) as T | undefined) ?? defaultValue;
  }

  public async update(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
    await this.afterUpdate?.();
  }
}

const draft: ProfileDraft = {
  name: 'Host A',
  alias: 'host-a',
  host: '192.0.2.10',
  port: 22,
  username: 'developer',
  keyStrategy: { kind: 'generated-per-host', keyId: '00000000-0000-4000-8000-000000000001' },
};

suite('ProfileStore', () => {
  test('persists profiles and rejects aliases case-insensitively', async () => {
    const store = new ProfileStore(new MemoryMemento());
    await store.add(draft);
    await assert.rejects(
      store.add({ ...draft, name: 'Other', alias: 'HOST-A' }),
      (error: unknown) => error instanceof DomainError && error.code === 'LOCAL_CONFIG_CONFLICT',
    );
    assert.equal(store.list().length, 1);
  });

  test('does not let endpoint edits or removal discard a managed deployment record', async () => {
    const store = new ProfileStore(new MemoryMemento());
    const original = await store.add(draft);
    await store.update({
      ...original,
      authorization: {
        ownership: 'managed',
        fingerprint: 'SHA256:key',
        deploymentMarker: 'ssh-onboard:profile:deployment',
        deployedPublicKeyLine: 'ssh-ed25519 AAAA ssh-onboard:profile:deployment',
        deployedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    await assert.rejects(
      store.updateDraft(original.id, { ...draft, host: '192.0.2.11' }),
      (error: unknown) => error instanceof DomainError && error.detail === 'revoke-before-edit',
    );
    await assert.rejects(
      store.remove(original.id),
      (error: unknown) => error instanceof DomainError && error.detail === 'revoke-before-remove',
    );
  });

  test('serializes mutations from separate extension hosts through the shared profile file', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'ssh-onboard-profiles-'));
    try {
      const first = new ProfileStore(new MemoryMemento(), storage);
      const second = new ProfileStore(new MemoryMemento(), storage);
      await Promise.all([
        first.add(draft),
        second.add({ ...draft, name: 'Host B', alias: 'host-b', host: '192.0.2.11' }),
      ]);

      assert.deepEqual(
        first.list().map((profile) => profile.alias),
        ['host-a', 'host-b'],
      );
      assert.deepEqual(
        second.list().map((profile) => profile.alias),
        ['host-a', 'host-b'],
      );
    } finally {
      await rm(storage, { recursive: true, force: true });
    }
  });

  test('rejects a concurrent operation on the same profile across extension hosts', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'ssh-onboard-operation-'));
    try {
      const first = new ProfileStore(new MemoryMemento(), storage);
      const second = new ProfileStore(new MemoryMemento(), storage);
      const profile = await first.add(draft);
      let release!: () => void;
      let started!: () => void;
      const startedPromise = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const active = first.withProfileOperation(profile.id, async () => {
        started();
        await gate;
      });
      await startedPromise;

      await assert.rejects(
        second.withProfileOperation(profile.id, () => undefined),
        (error: unknown) =>
          error instanceof DomainError && error.detail === 'profile-operation-in-progress',
      );
      release();
      await active;
    } finally {
      await rm(storage, { recursive: true, force: true });
    }
  });

  test('serializes configuration operations across extension hosts', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'ssh-onboard-configuration-'));
    try {
      const first = new ProfileStore(new MemoryMemento(), storage);
      const second = new ProfileStore(new MemoryMemento(), storage);
      let release!: () => void;
      let started!: () => void;
      const startedPromise = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const order: string[] = [];
      const active = first.withConfigurationOperation(async () => {
        order.push('first-start');
        started();
        await gate;
        order.push('first-end');
      });
      await startedPromise;
      const waiting = second.withConfigurationOperation(() => {
        order.push('second');
      });
      await new Promise((resolve) => setTimeout(resolve, 75));
      assert.deepEqual(order, ['first-start']);
      release();
      await Promise.all([active, waiting]);
      assert.deepEqual(order, ['first-start', 'first-end', 'second']);
    } finally {
      await rm(storage, { recursive: true, force: true });
    }
  });

  test('does not remove a configuration lock after its ownership token changes', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'ssh-onboard-lock-owner-'));
    try {
      const store = new ProfileStore(new MemoryMemento(), storage);
      const lockFile = path.join(storage, 'configuration.operation.lock');
      await store.withConfigurationOperation(async () => {
        await writeFile(lockFile, '{"token":"replacement"}\n', 'utf8');
      });
      assert.equal(await readFile(lockFile, 'utf8'), '{"token":"replacement"}\n');
    } finally {
      await rm(storage, { recursive: true, force: true });
    }
  });

  test('does not remove a profile storage lock after its ownership token changes', async () => {
    const storage = await mkdtemp(path.join(os.tmpdir(), 'ssh-onboard-storage-lock-owner-'));
    try {
      const lockFile = path.join(storage, 'profiles.lock');
      const state = new MemoryMemento(() =>
        writeFile(lockFile, '{"token":"replacement"}\n', 'utf8'),
      );
      const store = new ProfileStore(state, storage);

      await store.add(draft);

      assert.equal(await readFile(lockFile, 'utf8'), '{"token":"replacement"}\n');
    } finally {
      await rm(storage, { recursive: true, force: true });
    }
  });
});
