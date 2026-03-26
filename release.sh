#!/usr/bin/env bash
set -e

# Release script for Mango
# Usage: ./release.sh [major|minor|patch|x.y.z]
# Default: patch bump
#
# Detects the current OS and builds for it.
# Run on Windows first to create the release, then on Mac to add Mac artifacts
# (or vice versa). The second run detects the existing release and uploads to it.

CURRENT=$(node -p "require('./package.json').version")
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT"

ARG="${1:-patch}"

case "$ARG" in
  major) VERSION="$((MAJOR + 1)).0.0" ;;
  minor) VERSION="${MAJOR}.$((MINOR + 1)).0" ;;
  patch) VERSION="${MAJOR}.${MINOR}.$((PATCH + 1))" ;;
  *)
    if echo "$ARG" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'; then
      VERSION="$ARG"
    else
      echo "Usage: ./release.sh [major|minor|patch|x.y.z]"
      echo "Current version: $CURRENT"
      exit 1
    fi
    ;;
esac

# Detect OS
case "$(uname -s)" in
  Darwin*)  PLATFORM="mac" ;;
  MINGW*|MSYS*|CYGWIN*|Windows*) PLATFORM="win" ;;
  Linux*)   PLATFORM="linux" ;;
  *)        echo "Unknown platform: $(uname -s)"; exit 1 ;;
esac

echo "==> Releasing Mango v${VERSION} (was v${CURRENT}) on ${PLATFORM}"

# Check if this release tag already exists (second platform run)
RELEASE_EXISTS=false
if git tag -l "v${VERSION}" | grep -q "v${VERSION}"; then
  RELEASE_EXISTS=true
  echo "==> Tag v${VERSION} already exists — adding ${PLATFORM} artifacts to existing release"
fi

if [ "$RELEASE_EXISTS" = false ]; then
  # Update version in package.json
  node -e "
    const pkg = require('./package.json');
    pkg.version = '${VERSION}';
    require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
  "
  echo "==> Updated package.json to v${VERSION}"

  # Update splash screen version — compatible with both GNU and BSD sed
  if sed --version >/dev/null 2>&1; then
    sed -i "s/v${CURRENT}/v${VERSION}/g" resources/splash.html
  else
    sed -i '' "s/v${CURRENT}/v${VERSION}/g" resources/splash.html
  fi
  echo "==> Updated splash.html to v${VERSION}"

  # Commit and tag
  git add package.json resources/splash.html
  git commit -m "v${VERSION}"
  git tag "v${VERSION}"
  echo "==> Committed and tagged v${VERSION}"

  # Push
  git push
  git push --tags
  echo "==> Pushed to origin"
fi

# Build for current platform
echo "==> Building ${PLATFORM} installer..."
npx electron-builder "--${PLATFORM}"
echo "==> Build complete"

# Collect artifacts per platform
ARTIFACTS=()

if [ "$PLATFORM" = "win" ]; then
  ARTIFACTS+=(
    "dist/Mango-${VERSION}-setup.exe"
    "dist/Mango-${VERSION}-setup.exe.blockmap"
    "dist/latest.yml"
  )
elif [ "$PLATFORM" = "mac" ]; then
  # DMG for manual install, ZIP for auto-update
  [ -f "dist/Mango-${VERSION}.dmg" ]          && ARTIFACTS+=("dist/Mango-${VERSION}.dmg")
  [ -f "dist/Mango-${VERSION}.dmg.blockmap" ]  && ARTIFACTS+=("dist/Mango-${VERSION}.dmg.blockmap")
  [ -f "dist/Mango-${VERSION}-mac.zip" ]       && ARTIFACTS+=("dist/Mango-${VERSION}-mac.zip")
  [ -f "dist/Mango-${VERSION}-mac.zip.blockmap" ] && ARTIFACTS+=("dist/Mango-${VERSION}-mac.zip.blockmap")
  [ -f "dist/latest-mac.yml" ]                 && ARTIFACTS+=("dist/latest-mac.yml")
elif [ "$PLATFORM" = "linux" ]; then
  [ -f "dist/Mango-${VERSION}.AppImage" ]      && ARTIFACTS+=("dist/Mango-${VERSION}.AppImage")
  [ -f "dist/latest-linux.yml" ]               && ARTIFACTS+=("dist/latest-linux.yml")
fi

if [ ${#ARTIFACTS[@]} -eq 0 ]; then
  echo "==> ERROR: No artifacts found to upload"
  exit 1
fi

echo "==> Artifacts to upload:"
printf '    %s\n' "${ARTIFACTS[@]}"

# Create release or upload to existing release
if [ "$RELEASE_EXISTS" = false ]; then
  echo "==> Creating GitHub release v${VERSION}..."
  gh release create "v${VERSION}" \
    --title "Mango v${VERSION}" \
    --generate-notes \
    "${ARTIFACTS[@]}"
else
  echo "==> Uploading ${PLATFORM} artifacts to existing release v${VERSION}..."
  gh release upload "v${VERSION}" \
    "${ARTIFACTS[@]}" \
    --clobber
fi

echo ""
echo "==> Released Mango v${VERSION} (${PLATFORM})"
echo "    https://github.com/Ashalls/Mango/releases/tag/v${VERSION}"
