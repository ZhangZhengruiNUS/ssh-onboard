import * as assert from 'node:assert/strict';

import { createDiagnosticReport } from '../../domain/diagnostics';
import type { ServerProfile } from '../../domain/profiles';

suite('Diagnostic report', () => {
  test('does not expose or deterministically derive endpoint identity', () => {
    const profile: ServerProfile = {
      schemaVersion: 1,
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Sensitive display name',
      alias: 'sensitive-alias',
      host: 'secret.internal.example',
      port: 2222,
      username: 'secret-user',
      defaultPath: '/srv/private/project',
      platform: 'linux',
      keyStrategy: {
        kind: 'generated-per-host',
        keyId: '00000000-0000-4000-8000-000000000002',
      },
    };
    const serialized = JSON.stringify(
      createDiagnosticReport(
        profile,
        '0.1.0-preview.1',
        {
          platform: 'win32',
          architecture: 'x64',
          vscodeVersion: 'test',
          remoteSshInstalled: true,
          remoteSshActive: false,
        },
        '2026-01-01T00:00:00.000Z',
      ),
    );

    for (const secret of [
      profile.id,
      profile.name,
      profile.alias,
      profile.host,
      profile.username,
      String(profile.port),
      '/srv/private',
    ]) {
      assert.equal(serialized.includes(secret), false, secret);
    }
    assert.match(serialized, /project/u);
    assert.doesNotMatch(serialized, /endpointHash/u);
  });
});
