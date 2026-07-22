# SSH Onboard {{VERSION}} Preview

> This is a preview build for controlled testing. It is not a stable release.

## Supported scope

- Local: Windows 10/11 x64 with Windows OpenSSH and VS Code Remote - SSH.
- Remote: a direct, standard Linux OpenSSH server and a Linux account with a writable home directory. Root is supported when privileged key access is intentional.
- Default key strategy: one dedicated, unencrypted Ed25519 key per host.

## Known limitations

- One-time password bootstrap has not yet completed a real Windows-to-Linux end-to-end test.
- Public-key deployment to a real Linux `authorized_keys` file has not yet completed that end-to-end test.
- Opening the configured default folder through the official Remote - SSH extension has not yet completed that end-to-end test.
- Windows paths must expose a verifiable security descriptor and an exact protected DACL. An explicitly absent owner is accepted only when that DACL contains exactly the current user and SYSTEM; unreadable or ambiguous ACL state fails closed.

Use a disposable test server and account. If testing root, use only a disposable host: the installed key grants privileged passwordless access. Do not use this preview for production access.

## Install

Download `ssh-onboard-{{VERSION}}.vsix`, then run:

```powershell
code --install-extension .\ssh-onboard-{{VERSION}}.vsix
```

## Verify the download

Compare the VSIX SHA-256 with `SHA256SUMS.txt`:

```powershell
Get-FileHash -Algorithm SHA256 .\ssh-onboard-{{VERSION}}.vsix
```

When GitHub artifact attestations are available, also run:

```powershell
gh attestation verify .\ssh-onboard-{{VERSION}}.vsix --repo ZhangZhengruiNUS/ssh-onboard
```

## Changes

{{GENERATED_NOTES}}
