# SSH Onboard {{VERSION}}

## Supported scope

- Local: Windows 10/11 x64 with Windows OpenSSH and VS Code Remote - SSH.
- Remote: a direct, standard Linux OpenSSH server and a non-root user.

## Install

Download `ssh-onboard-{{VERSION}}.vsix`, verify it, then run:

```powershell
code --install-extension .\ssh-onboard-{{VERSION}}.vsix
```

## Verify the download

```powershell
Get-FileHash -Algorithm SHA256 .\ssh-onboard-{{VERSION}}.vsix
gh attestation verify .\ssh-onboard-{{VERSION}}.vsix --repo ZhangZhengruiNUS/ssh-onboard
```

Compare the hash with `SHA256SUMS.txt` before installation.

## Changes

{{GENERATED_NOTES}}
