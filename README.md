# SSH Onboard

[简体中文](README.zh-CN.md)

> Preview software. Test with a disposable server before using valuable infrastructure. Download the current build from [GitHub Releases](https://github.com/ZhangZhengruiNUS/ssh-onboard/releases).

SSH Onboard turns the one-time SSH key setup into a guided workflow, then hands everyday remote development back to Microsoft's Remote - SSH extension.

## Why SSH Onboard

Microsoft's **Remote - SSH** provides an excellent remote-development experience: remote files, integrated terminals, remote extensions, language services, Git, debugging, and port forwarding. However, password authentication is not remembered and automatically replayed for new connections.

The usual answer is to generate an SSH key locally and upload its public key to `~/.ssh/authorized_keys`. That is routine for experienced SSH users, but it is easy for newcomers to choose the wrong file, damage `authorized_keys`, apply unsafe permissions, edit the wrong SSH config, or never verify which identity actually authenticated.

Opening the same remote project folder is another recurring annoyance. Developers often connect to one host and always work in one directory, yet still have to open that directory manually—and may encounter another password prompt while switching windows.

SSH Onboard exists to make that setup explicit and repeatable:

```text
Add a host and its default folder
→ inspect and independently verify the host fingerprint
→ enter the server password once (never saved)
→ generate or select an SSH key
→ safely add the public key and verify key-only login
→ open the default folder with Microsoft Remote - SSH
```

SSH Onboard is **not another SSH client**. It is a thin enhancement for Microsoft's Remote - SSH. Explorer, terminals, remote extensions, Git, debugging, and language tooling remain provided by Remote - SSH.

## V0.1 features

- Native Tree View for adding, grouping, editing, searching, and removing hosts.
- One-time password bootstrap after an explicit host-fingerprint trust decision.
- A dedicated Ed25519 key per host by default.
- Advanced choice of an existing unencrypted key or an explicitly shared generated group key.
- Conflict-aware SSH Config Include management and an isolated `known_hosts` file.
- Conservative, lock-protected `authorized_keys` updates and exact managed-key revocation.
- Non-interactive OpenSSH verification with one configured identity and password fallback disabled.
- One-click Remote - SSH launch directly into the verified default folder.
- Sanitized diagnostics and profile export; no telemetry, cloud sync, AI, or paid features.

## Supported environment

- Local: Windows x64, VS Code Desktop, and Windows OpenSSH Client.
- Remote: a directly reachable standard Linux OpenSSH server that allows password and public-key authentication.
- Account: a normal Linux user with a writable home directory.

Root accounts, jump hosts, MFA, nonstandard `AuthorizedKeysFile` layouts, encrypted existing keys, and macOS/Linux clients are outside V0.1's tested scope.

## Install

To install the current GitHub Preview:

1. Download `ssh-onboard-<version>.vsix` from [Releases](https://github.com/ZhangZhengruiNUS/ssh-onboard/releases).
2. In VS Code, run **Extensions: Install from VSIX...**.
3. Select the downloaded file and reload VS Code.

For local development builds:

```powershell
npm ci
npm run check
npm run package:vsix
```

Install the generated `artifacts/ssh-onboard-<version>.vsix` only in a test VS Code profile until the release notes say otherwise.

## Use

1. Open the **SSH Onboard** Activity Bar view and select **Add Host**.
2. Enter the host, user, SSH alias, optional group, and default absolute POSIX path.
3. Keep the recommended per-host key, or open the advanced key strategy options.
4. Select **Initialize Key Access**.
5. Verify the displayed SSH host fingerprint through an independent channel before accepting it.
6. Enter the SSH password once. SSH Onboard does not persist it.
7. After verification succeeds, select **Connect and Open Default Folder**.

## Security model

- Passwords, passphrases, and OTPs are never persisted or logged.
- Authentication is not attempted before a host fingerprint is shown and trusted.
- SSH Onboard does not disable host-key checking or use `/dev/null` as `known_hosts`.
- Managed private-key ACLs allow only the current Windows user and `SYSTEM`.
- Existing `authorized_keys` bytes are preserved; unsafe ownership, layout, links, or concurrent edits stop the operation.
- Final success requires system OpenSSH to complete a BatchMode login using the exact managed identity.
- Exported profiles omit passwords, keys, key paths, and host trust records.

Read [SECURITY.md](SECURITY.md) before using preview builds with valuable infrastructure. Report vulnerabilities through its private reporting channel, not a public issue.

## Project documents

- [Product specification](docs/PRODUCT_SPEC.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security design and threat model](docs/SECURITY.md)
- [Development and release plan](docs/DEVELOPMENT_PLAN.md)
- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)

## License and naming

SSH Onboard is released under the [MIT License](LICENSE). Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

The project is not affiliated with or endorsed by Microsoft. “Remote - SSH” and other product names belong to their respective owners.
