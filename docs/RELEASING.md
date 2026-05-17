# Releasing Mango

Production releases are produced by `.github/workflows/release.yml` when a tag
matching `v*` is pushed. The workflow runs on both `windows-latest` and
`macos-latest` and uploads to the GitHub release identified by the tag.

## Current signing status: unsigned

Mango currently ships **unsigned** on both platforms. This means:

- **Windows:** SmartScreen shows an "unrecognized app" warning on first install.
  Users click "More info" → "Run anyway" to proceed.
- **macOS:** Gatekeeper refuses to open the app on first launch. Users right-click
  → "Open" → confirm, or remove the quarantine attribute manually:
  ```
  xattr -dr com.apple.quarantine /Applications/Mango.app
  ```

These warnings are normal for unsigned apps and do not indicate that anything
is wrong with Mango — they exist because the OS cannot verify the publisher.

## Cutting a release

```bash
# 1. Bump version in package.json
pnpm version patch  # or minor / major
# 2. Push the tag the version bump created
git push --follow-tags
```

The workflow takes ~10–15 minutes per OS. The release is created as a draft —
review the artifacts on the releases page, then publish.

## SHA256SUMS

The workflow publishes a `SHA256SUMS` file alongside the release artifacts.
The macOS in-app updater (`src/main/services/macUpdater.ts`) reads this file
and verifies the downloaded DMG against the listed hash before opening it. If
the file is missing the updater logs a warning and proceeds; if the file is
present and the hash doesn't match, the updater refuses to install.

Note: SHA256SUMS alone does **not** authenticate the publisher — anyone who
can publish a GitHub release can also publish a matching sums file. The
checksum protects against download corruption and CDN tampering, not against
GitHub-side compromise. Real publisher authentication requires code signing
(see below).

## Adding code signing later

When you obtain a code-signing certificate, add the relevant secrets in
**Settings → Secrets and variables → Actions**:

### Windows (EV or OV cert from Sectigo/DigiCert/SSL.com)

| Secret | Purpose |
|---|---|
| `WIN_CSC_LINK` | Base64 of the `.pfx` certificate. `base64 -w 0 mango.pfx \| pbcopy`. |
| `WIN_CSC_KEY_PASSWORD` | Password protecting the `.pfx`. |

Then in `electron-builder.yml`:
```yaml
win:
  signAndEditExecutable: true
  signingHashAlgorithms: [sha256]
  rfc3161TimeStampServer: http://timestamp.digicert.com
nsis:
  publisherName: "<Subject CN from your cert>"
```

### macOS (Apple Developer Program — $99/yr)

| Secret | Purpose |
|---|---|
| `MAC_CSC_LINK` | Base64 of the Developer ID `.p12`. |
| `MAC_CSC_KEY_PASSWORD` | `.p12` password. |
| `APPLE_ID` | Apple ID email used for notarization. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com → Sign-in & Security → App-Specific Passwords. |
| `APPLE_TEAM_ID` | 10-char Team ID from the Apple developer portal → Membership. |

Then in `electron-builder.yml`:
```yaml
mac:
  hardenedRuntime: true
  gatekeeperAssess: true
  notarize: true
  entitlements: resources/entitlements.mac.plist
  entitlementsInherit: resources/entitlements.mac.plist
```

The entitlements file is already in place at `resources/entitlements.mac.plist`
with the entries required for an Electron app running under hardened runtime
(JIT, library validation disabled for Claude SDK native modules, network
client, process inheritance).
