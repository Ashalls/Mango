# Releasing Mango

Production releases are produced by `.github/workflows/release.yml` when a tag
matching `v*` is pushed. The workflow runs on both `windows-latest` and
`macos-14` and uploads to the GitHub release identified by the tag.

## Required secrets

Set these in **Settings → Secrets and variables → Actions** before pushing a
signed release. If a secret is missing the workflow still runs, but the
resulting artifact is unsigned (Windows SmartScreen will flag it; macOS
Gatekeeper will refuse to open it).

| Secret | Purpose | How to obtain |
|---|---|---|
| `WIN_CSC_LINK` | Base64 of the Windows `.pfx` code-signing certificate. `base64 -w 0 mango.pfx \| pbcopy`, then paste. | Buy an OV or EV cert from Sectigo/DigiCert/SSL.com. EV is required to bypass SmartScreen reputation. |
| `WIN_CSC_KEY_PASSWORD` | Password protecting the `.pfx`. | Set when you exported the cert. |
| `MAC_CSC_LINK` | Base64 of the macOS Developer ID `.p12`. | Apple Developer portal → Certificates → Developer ID Application → Export as `.p12`. |
| `MAC_CSC_KEY_PASSWORD` | Password protecting the `.p12`. | Set when you exported. |
| `APPLE_ID` | Apple ID email used for notarization. | Apple developer account. |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID. | https://appleid.apple.com → Sign-in & Security → App-Specific Passwords. |
| `APPLE_TEAM_ID` | 10-char Team ID. | Apple developer portal → Membership. |

## Verification on the client side

`src/main/services/macUpdater.ts` downloads the DMG from the GitHub release
and verifies its SHA256 against the `SHA256SUMS` asset that the workflow
publishes alongside the artifacts. If the SHA256SUMS asset is missing or the
hash does not match, the updater refuses to install.

Note: SHA256SUMS alone does **not** authenticate the publisher — anyone who
can publish to the GitHub release can also publish a matching sums file.
The first real authentication step is **code signing**. Set the secrets
above before the next release.

## Cutting a release

```bash
# 1. Bump version in package.json
pnpm version patch  # or minor / major
# 2. Push the tag the version bump created
git push --follow-tags
```

The workflow takes ~10–15 minutes per OS. The release is created as a draft
— review the artifacts on the releases page, then publish.
