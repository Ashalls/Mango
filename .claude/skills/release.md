---
name: release
description: Build and publish a new GitHub release with proper electron-updater assets
user_invocable: true
---

# Release Process

Execute these steps in order to create a proper release for the Mango Electron app.

## Steps

1. **Bump version**: Run `npm version patch --no-git-tag-version` (or `minor`/`major` if specified by user).

2. **Build the app**: Run `npm run build` to compile with electron-vite.

3. **Build distributable**: Run `npx electron-builder --win` to create the Windows installer.

4. **Verify dist artifacts exist** — all three are required for electron-updater:
   - `dist/Mango-{version}-setup.exe`
   - `dist/Mango-{version}-setup.exe.blockmap`
   - `dist/latest.yml`

5. **Commit and tag**:
   - `git add package.json`
   - `git commit -m "v{version}"`
   - `git tag v{version}`
   - `git push && git push --tags`

6. **Create GitHub release** with ALL three artifacts:
   ```
   gh release create v{version} \
     "dist/Mango-{version}-setup.exe" \
     "dist/Mango-{version}-setup.exe.blockmap" \
     "dist/latest.yml" \
     --title "v{version}" \
     --notes "release notes here"
   ```

7. **Verify** the release has all 3 assets: `gh release view v{version} --json assets --jq '.assets[].name'`

## Important

- The `latest.yml` and `.blockmap` files MUST be uploaded — without them, electron-updater auto-update will not work.
- The splash screen version is set dynamically from `app.getVersion()` (which reads `package.json`), so bumping `package.json` is sufficient — no need to edit `resources/splash.html`.
- Ask the user for release notes or generate them from commits since the last tag.
