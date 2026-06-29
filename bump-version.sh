#!/usr/bin/env bash

# Default to patch, allow --minor or --major
BUMP_TYPE="patch"
for arg in "$@"; do
  if [ "$arg" == "--minor" ]; then BUMP_TYPE="minor"; fi
  if [ "$arg" == "--major" ]; then BUMP_TYPE="major"; fi
done

echo "Bumping $BUMP_TYPE version..."

# 1. Bump the version (updates files, but does NOT commit or tag)
pnpm version $BUMP_TYPE --no-git-tag-version

# Read the newly generated version
NEW_VERSION=$(node -p "require('./package.json').version")
BRANCH_NAME="release/v$NEW_VERSION"

# 2. Create the new release branch carrying over our uncommitted version bumps
echo "Creating new branch: $BRANCH_NAME..."
git checkout -b "$BRANCH_NAME"

# 3. Stage package.json and commit everything
# (Our sync-version.mjs already staged the Tauri files)
git add package.json
git commit -m "chore: bump version to v$NEW_VERSION"

# 4. Push the new branch to GitHub
echo "Pushing branch to GitHub..."
git push -u origin "$BRANCH_NAME"

echo "✅ Version bumped to v$NEW_VERSION, committed, and pushed!"
echo "➡️  Next step: Go to GitHub and open PRs to merge $BRANCH_NAME into main and dev."