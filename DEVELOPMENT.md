# Development

## Releases

Creating a new release involves the following steps:

- Prepare a new release branch from `main`
  - Update [CHANGELOG.md](./CHANGELOG.md) with all notable changes since the last tag
  - Update `package.json` with the new version number (e.g. `0.50.0`)
  - Submit a PR to `main` and get it approved and merged
  - Run `vsce package` to create the VSIX package and ensure it builds correctly first.
- Create a new tag for the release with that version number (e.g. `git tag v0.50.0`)
- Push the tag (`git push origin v0.50.0`)
- [Monitor the release](https://github.com/open-policy-agent/vscode-opa/actions), it should be automated in actions on the repo.
- Check `https://marketplace.visualstudio.com/manage/publishers/tsandall` to ensure it's now in status "Verifying"
- Create a release in the UI, use the same notes as the changelog update. Also use the
  generated release notes to get the full commit list at the bottom.
- Upload the VSIX file manually to the release.

