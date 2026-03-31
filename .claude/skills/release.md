---
name: release
description: Bump version, tag, push, and trigger CI to build and publish a GitHub release
user_invocable: true
argument-hint: "[patch|minor|major]"
---

# Release Process

Create a new release for Mango. CI (`.github/workflows/release.yml`) automatically builds Windows + macOS distributables and creates the GitHub Release when a `v*` tag is pushed.

## Steps

1. **Check for uncommitted changes**: Run `git status --short`. If there are uncommitted changes, ask the user whether to commit them first or abort.

2. **Determine version bump**: Default to `patch`. If the user specified `minor` or `major` as an argument, use that instead.

3. **Bump version**: Run `npm version {patch|minor|major} --no-git-tag-version`.

4. **Commit version bump**:
   ```
   git add package.json
   git commit -m "v{version}"
   ```

5. **Tag**:
   ```
   git tag v{version}
   ```

6. **Push commits and tag**:
   ```
   git push && git push --tags
   ```

7. **Verify CI triggered**: Run `gh run list --limit 3` to confirm the Release workflow started.

8. **Report**: Tell the user the release is in progress with a link to the Actions run.

## Important

- Do NOT build locally or create the GitHub Release manually — CI handles everything.
- The splash screen version reads from `package.json` at runtime, so bumping `package.json` is sufficient.
- CI builds both Windows (.exe) and macOS (.dmg) and uploads all artifacts including `latest.yml` and `.blockmap` files needed for auto-update.
