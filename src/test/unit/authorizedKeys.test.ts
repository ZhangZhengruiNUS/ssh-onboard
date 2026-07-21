import * as assert from 'node:assert/strict';

import { DomainError } from '../../core/domainError';
import {
  appendAuthorizedKey,
  createDeploymentPlan,
  revokeAuthorizedKey,
} from '../../domain/authorizedKeys';

const publicKey =
  'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA user@local';

suite('authorized_keys transforms', () => {
  test('preserves existing bytes and adds exactly one managed line', () => {
    const source = Buffer.from(
      '# existing\nssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCa comment',
      'utf8',
    );
    const plan = createDeploymentPlan(publicKey, 'profile-id', 'deployment-id');
    const result = appendAuthorizedKey(source, plan);

    assert.equal(result.alreadyPresent, false);
    assert.equal(result.content.subarray(0, source.length).equals(source), true);
    assert.equal(result.content.toString('utf8').endsWith(`${plan.deployedPublicKeyLine}\n`), true);
  });

  test('preserves non-UTF-8 bytes exactly while appending a managed key', () => {
    const source = Buffer.from([0xff, 0xfe, 0x0a]);
    const plan = createDeploymentPlan(publicKey, 'profile-id', 'deployment-id');
    const result = appendAuthorizedKey(source, plan);

    assert.equal(result.content.subarray(0, source.length).equals(source), true);
  });

  test('treats another line with the same key fingerprint as externally managed', () => {
    const source = Buffer.from(publicKey, 'utf8');
    const plan = createDeploymentPlan(publicKey, 'profile-id', 'deployment-id');
    const result = appendAuthorizedKey(source, plan);

    assert.equal(result.alreadyPresent, true);
    assert.equal(result.content.equals(source), true);
  });

  test('recovers the exact pending managed line without appending a duplicate', () => {
    const plan = createDeploymentPlan(publicKey, 'profile-id', 'deployment-id');
    const source = Buffer.from(`${plan.deployedPublicKeyLine}\n`, 'utf8');
    const result = appendAuthorizedKey(source, plan);

    assert.equal(result.alreadyPresent, false);
    assert.equal(result.content.equals(source), true);
    assert.equal(result.deploymentMarker, plan.deploymentMarker);
  });

  test('revokes only the unique exact managed line', () => {
    const plan = createDeploymentPlan(publicKey, 'profile-id', 'deployment-id');
    const source = Buffer.from(`# keep\n${plan.deployedPublicKeyLine}\n`, 'utf8');
    const result = revokeAuthorizedKey(
      source,
      plan.deployedPublicKeyLine,
      plan.deploymentMarker,
      plan.fingerprint,
    );

    assert.equal(result.removed, true);
    assert.equal(result.content.toString('utf8'), '# keep\n');
  });

  test('rejects a managed line when another authorization has the same fingerprint', () => {
    const plan = createDeploymentPlan(publicKey, 'profile-id', 'deployment-id');
    const duplicate = publicKey.replace('user@local', 'restricted-copy');
    const source = Buffer.from(`${plan.deployedPublicKeyLine}\n${duplicate}\n`, 'utf8');

    assert.throws(
      () => appendAuthorizedKey(source, plan),
      (error: unknown) => error instanceof DomainError && error.detail === 'ambiguous-fingerprint',
    );
    assert.throws(
      () =>
        revokeAuthorizedKey(
          source,
          plan.deployedPublicKeyLine,
          plan.deploymentMarker,
          plan.fingerprint,
        ),
      (error: unknown) => error instanceof DomainError && error.detail === 'ambiguous-fingerprint',
    );
  });

  test('rejects revocation when the exact managed line is missing', () => {
    const plan = createDeploymentPlan(publicKey, 'profile-id', 'deployment-id');
    const external = Buffer.from(publicKey.replace('user@local', 'external-copy'), 'utf8');

    assert.throws(
      () =>
        revokeAuthorizedKey(
          external,
          plan.deployedPublicKeyLine,
          plan.deploymentMarker,
          plan.fingerprint,
        ),
      (error: unknown) => error instanceof DomainError && error.detail === 'ambiguous-fingerprint',
    );
    assert.throws(
      () =>
        revokeAuthorizedKey(
          Buffer.alloc(0),
          plan.deployedPublicKeyLine,
          plan.deploymentMarker,
          plan.fingerprint,
        ),
      DomainError,
    );
  });
});
