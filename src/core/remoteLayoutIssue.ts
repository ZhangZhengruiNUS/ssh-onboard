export const REMOTE_LAYOUT_REASONS = [
  'authorized-keys-owner',
  'authorized-keys-permissions',
  'authorized-keys-size',
  'authorized-keys-type',
  'layout-values',
  'probe-failed',
  'probe-output-limit',
  'root-home',
  'sftp-read-failed',
  'sftp-stat-failed',
  'sftp-unavailable',
  'ssh-directory-create-failed',
  'ssh-directory-missing',
  'ssh-directory-owner',
  'ssh-directory-permissions',
  'ssh-directory-type',
  'unknown',
] as const;

export type RemoteLayoutReason = (typeof REMOTE_LAYOUT_REASONS)[number];

const REMOTE_LAYOUT_REASON_SET = new Set<string>(REMOTE_LAYOUT_REASONS);

export function remoteLayoutReason(detail: string | undefined): RemoteLayoutReason {
  return detail !== undefined && REMOTE_LAYOUT_REASON_SET.has(detail)
    ? (detail as RemoteLayoutReason)
    : 'unknown';
}
