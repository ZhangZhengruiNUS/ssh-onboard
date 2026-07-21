# Changelog

All notable changes to SSH Onboard will be documented in this file.

The project follows [Semantic Versioning](https://semver.org/) after its first public release.

## [Unreleased]

### Added

- Initial VS Code extension scaffold, localization, native Tree View, tests, CI, and security-focused project documentation.
- Host profiles with groups, search, default folders, sanitized export, and diagnostics.
- One-time password bootstrap with explicit SSH host-fingerprint verification.
- Per-host Ed25519 keys by default, plus advanced existing and shared-group key strategies.
- Conservative, recoverable `authorized_keys` deployment and exact managed-key revocation.
- Conflict-aware OpenSSH config management, isolated `known_hosts`, strict expanded-config assertions, and BatchMode verification.
- Microsoft Remote - SSH launch into the verified default folder.
