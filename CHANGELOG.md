# Changelog

All notable changes to SSH Onboard will be documented in this file.

The project follows [Semantic Versioning](https://semver.org/) after its first public release.

## [Unreleased]

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
