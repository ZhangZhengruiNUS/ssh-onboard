import { Client, type ConnectConfig, type PasswordAuthMethod } from 'ssh2';
import { readFile } from 'node:fs/promises';

import { DomainError } from '../core/domainError';
import { parseHostKey, type HostKeyObservation } from '../domain/hostKeys';
import type { ServerProfile, TrustedHostKey } from '../domain/profiles';

export class BootstrapClient {
  public probeHostKey(profile: ServerProfile): Promise<HostKeyObservation> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let observation: HostKeyObservation | undefined;
      let settled = false;
      const finish = (result?: HostKeyObservation, errorDetail?: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        client.end();
        if (result === undefined) {
          reject(new DomainError('HOST_KEY_UNTRUSTED', errorDetail));
        } else {
          resolve(result);
        }
      };
      const timeout = setTimeout(() => {
        finish(undefined, 'timeout');
      }, 15_000);
      client.once('error', () => {
        finish(observation, observation === undefined ? 'connection' : undefined);
      });
      client.once('close', () => {
        finish(observation, observation === undefined ? 'connection' : undefined);
      });
      client.connect({
        host: profile.host,
        port: profile.port,
        username: profile.username,
        readyTimeout: 12_000,
        keepaliveInterval: 0,
        hostVerifier: (rawKey: Buffer) => {
          try {
            observation = parseHostKey(rawKey);
          } catch {
            return false;
          }
          setImmediate(() => finish(observation));
          return false;
        },
      });
    });
  }

  public connectWithPassword(
    profile: ServerProfile,
    password: string,
    trustedHostKey: TrustedHostKey,
  ): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      let hostKeyMatched = false;
      let ready = false;
      const passwordAuth: PasswordAuthMethod = {
        type: 'password',
        username: profile.username,
        password,
      };
      client.once('ready', () => {
        ready = true;
        resolve(client);
      });
      client.once('error', () => {
        client.end();
        reject(new DomainError(hostKeyMatched ? 'AUTH_FAILED' : 'HOST_KEY_CHANGED'));
      });
      client.once('close', () => {
        if (!ready) {
          reject(new DomainError(hostKeyMatched ? 'AUTH_FAILED' : 'HOST_KEY_CHANGED'));
        }
      });
      const config: ConnectConfig = {
        host: profile.host,
        port: profile.port,
        username: profile.username,
        readyTimeout: 15_000,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
        hostVerifier: (rawKey: Buffer) => {
          try {
            const observation = parseHostKey(rawKey);
            hostKeyMatched =
              observation.algorithm === trustedHostKey.algorithm &&
              observation.fingerprint === trustedHostKey.fingerprint &&
              observation.keyBase64 === trustedHostKey.keyBase64;
          } catch {
            hostKeyMatched = false;
          }
          return hostKeyMatched;
        },
        authHandler: [passwordAuth],
      };
      client.connect(config);
    });
  }

  public async connectWithPrivateKey(
    profile: ServerProfile,
    privateKeyPath: string,
    trustedHostKey: TrustedHostKey,
  ): Promise<Client> {
    const privateKey = await readFile(privateKeyPath).catch(() => {
      throw new DomainError('AUTH_FAILED', 'private-key');
    });
    return new Promise((resolve, reject) => {
      const client = new Client();
      let hostKeyMatched = false;
      let ready = false;
      client.once('ready', () => {
        ready = true;
        privateKey.fill(0);
        resolve(client);
      });
      client.once('error', () => {
        privateKey.fill(0);
        client.end();
        reject(new DomainError(hostKeyMatched ? 'AUTH_FAILED' : 'HOST_KEY_CHANGED'));
      });
      client.once('close', () => {
        privateKey.fill(0);
        if (!ready) {
          reject(new DomainError(hostKeyMatched ? 'AUTH_FAILED' : 'HOST_KEY_CHANGED'));
        }
      });
      client.connect({
        host: profile.host,
        port: profile.port,
        username: profile.username,
        privateKey,
        readyTimeout: 15_000,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
        hostVerifier: (rawKey: Buffer) => {
          try {
            const observation = parseHostKey(rawKey);
            hostKeyMatched =
              observation.algorithm === trustedHostKey.algorithm &&
              observation.fingerprint === trustedHostKey.fingerprint &&
              observation.keyBase64 === trustedHostKey.keyBase64;
          } catch {
            hostKeyMatched = false;
          }
          return hostKeyMatched;
        },
      });
    });
  }
}
