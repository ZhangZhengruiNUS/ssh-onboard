# Changelog

All notable changes to SSH Onboard will be documented in this file.

The project follows [Semantic Versioning](https://semver.org/) after its first public release.

## [Unreleased]

## [0.1.0-preview.3] - 2026-07-22

### Added

- Add and Edit now open one accessible, theme-aware editor form with inline validation, alias suggestions, default-folder setup, and advanced key strategies.
- Existing private keys are selected through the native file picker; the Webview receives only a short label and a short-lived one-use token.

### Fixed

- Recover only the exact `preview.2` interrupted first-trust layout while leaving unknown managed-file differences untouched.
- Removing an uninitialized host no longer reads or changes OpenSSH configuration, and removing a trust-only host keeps the user config byte-for-byte unchanged.
- Configuration failures now distinguish workspace-scoped Remote - SSH settings, alias and Include conflicts, external changes, invalid state, lock contention, unsafe files, and expanded-config verification errors.

### Security

- Revoking a managed key now warns users to confirm an alternate login or console path first.
- Pre-existing SSH Onboard directories are validated without rewriting their Windows ACLs.
- Initialization now runs configuration preflight checks before networking, before remote key deployment, and again during the final local commit.
- Managed SSH state is bound to one local profile authority, committed with state last, and protected by ownership-token locks and rollback on interrupted writes.
- The host form uses a deny-by-default CSP, exact bounded message schemas, stale-edit detection, and panel-bound anti-replay tokens without exposing key paths or authorization records.

### Known limitations

- This Preview has not yet completed a real Windows-to-Linux password bootstrap, `authorized_keys`, BatchMode, and Remote - SSH default-folder end-to-end test.
- Use a disposable Linux account and verify the displayed host fingerprint independently before entering a password.

## [0.1.0-preview.2] - 2026-07-21

### Fixed

- Release smoke tests now download an isolated VS Code build instead of assuming the `code` command is available on GitHub-hosted Windows runners.

## [0.1.0-preview.1] - 2026-07-21

### Added

- Initial VS Code extension scaffold, localization, native Tree View, tests, CI, and security-focused project documentation.
- Host profiles with groups, search, default folders, sanitized export, and diagnostics.
- One-time password bootstrap with explicit SSH host-fingerprint verification.
- Per-host Ed25519 keys by default, plus advanced existing and shared-group key strategies.
- Conservative, recoverable `authorized_keys` deployment and exact managed-key revocation.
- Conflict-aware OpenSSH config management, isolated `known_hosts`, strict expanded-config assertions, and BatchMode verification.
- Microsoft Remote - SSH launch into the verified default folder.

### Known limitations

- This Preview has not yet completed a real Windows-to-Linux password-bootstrap, `authorized_keys`, and Remote - SSH end-to-end test.
- Windows paths with unreadable or ambiguous security descriptors fail closed. An explicitly absent owner is accepted only when the protected DACL exactly grants FullControl to the current user and SYSTEM.
