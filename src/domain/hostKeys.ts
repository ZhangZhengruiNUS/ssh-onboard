import { fingerprintBlob } from './keys';

export interface HostKeyObservation {
  readonly algorithm: string;
  readonly fingerprint: string;
  readonly keyBase64: string;
}

export function parseHostKey(rawKey: Buffer): HostKeyObservation {
  if (rawKey.length < 5) {
    throw new Error('Invalid SSH host key.');
  }
  const algorithmLength = rawKey.readUInt32BE(0);
  if (algorithmLength < 1 || algorithmLength > rawKey.length - 4) {
    throw new Error('Invalid SSH host key algorithm.');
  }
  const algorithm = rawKey.subarray(4, 4 + algorithmLength).toString('ascii');
  if (!/^[A-Za-z0-9@._+-]+$/u.test(algorithm)) {
    throw new Error('Invalid SSH host key algorithm.');
  }
  return {
    algorithm,
    fingerprint: fingerprintBlob(rawKey),
    keyBase64: rawKey.toString('base64'),
  };
}

export function knownHostsAddress(host: string, port: number): string {
  return port === 22 ? host : `[${host}]:${String(port)}`;
}
