# Development

## Releases

Creating a new release involves the following steps:

- Prepare a new release branch from `main`
  - Update [CHANGELOG.md](./CHANGELOG.md) with all notable changes since the last tag
  - Update `package.json` with the new version number (e.g. `0.50.0`)
  - Submit a PR to `main` and get it approved and merged
- Create a new tag for the release with that version number (e.g. `git tag v0.50.0`)
- Run `vsce package` to create the VSIX package and ensure it builds correctly
- Push the tag (`git push origin v0.50.0`)
- `vsce publish --pat $TOKEN --no-git-tag-version --no-update-package-json`
- Check `https://marketplace.visualstudio.com/manage/publishers/tsandall` to ensure it's now in status "Verifying"
