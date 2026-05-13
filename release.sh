#!/usr/bin/env bash
set -e

# Release script for Mango
# Usage: ./release.sh [major|minor|patch|x.y.z]
# Default: patch bump
#
# Bumps version, commits, tags, and pushes.
# GitHub Actions builds for Windows + macOS and creates the release automatically.

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

echo "==> Releasing Mango v${VERSION} (was v${CURRENT})"

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

# Push — tag push triggers GitHub Actions release workflow
git push
git push --tags
echo "==> Pushed to origin"

echo ""
echo "==> Tag v${VERSION} pushed. GitHub Actions will now:"
echo "    1. Build Windows installer (.exe)"
echo "    2. Build macOS installer (.dmg + .zip)"
echo "    3. Create GitHub release with all artifacts"
echo ""
echo "    Watch progress: https://github.com/Ashalls/Mango/actions"
