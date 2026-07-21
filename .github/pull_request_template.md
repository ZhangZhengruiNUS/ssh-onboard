# Pull request

## Summary

Describe the user-visible or engineering change.

## Security impact

- [ ] No credentials, private keys, host lists, or full SSH commands are logged.
- [ ] No workspace content is executed or used as SSH configuration.
- [ ] Host trust and authentication behavior are unchanged, or the change is documented.

## Validation

- [ ] `npm ci`
- [ ] `npm run check`
- [ ] `npm run test:extension`
- [ ] `npm run package:vsix`
- [ ] `npm run vsce:ls`
