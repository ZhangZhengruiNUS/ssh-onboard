# Contributing to SSH Onboard

SSH Onboard is developed in small, reviewable changes. Before proposing code, read the [product scope](docs/PRODUCT_SPEC.md), [architecture](docs/ARCHITECTURE.md), and [security model](docs/SECURITY.md).

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Local setup

Use Node.js 24 and npm 11.x, as declared by the repository toolchain checks:

```powershell
npm ci
npm run check
npm run test:extension
npm run package:vsix
```

Do not use real server addresses, credentials, private keys, host lists, or unredacted SSH logs in tests, fixtures, issues, or pull requests. Examples must use reserved documentation addresses and synthetic identities.

## Pull requests

- Keep each pull request focused and explain its user impact.
- Add or update tests for behavior changes.
- Update the security model when authentication, host trust, key handling, or file writes change.
- Run the complete local quality gate before requesting review.
- Do not commit generated `dist`, `out`, `.vscode-test`, `artifacts`, or `node_modules` content.

Security vulnerabilities must follow [SECURITY.md](SECURITY.md) and must not be opened as public issues.
