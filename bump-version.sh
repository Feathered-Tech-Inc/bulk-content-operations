#!/usr/bin/env bash

echo "Switching to dev branch and pulling latest changes..."
git checkout dev
git pull origin dev

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

# 5. Create a PR to merge the new release branch into main and dev
if command -v gh &> /dev/null; then
  echo "GitHub CLI found. Creating Pull Requests..."
  gh pr create --base main --head "$BRANCH_NAME" --title "chore: release v$NEW_VERSION" --body "Automated release PR for v$NEW_VERSION targeting main."
  gh pr create --base dev --head "$BRANCH_NAME" --title "chore: sync release v$NEW_VERSION to dev" --body "Automated release PR for v$NEW_VERSION syncing back to dev."
  echo "✅ Pull Requests created successfully!"
else
  echo "⚠️ GitHub CLI (gh) not found. Skipping automated PR creation."
  echo "➡️ Next step: Go to GitHub and open PRs to merge $BRANCH_NAME into main and dev."
fi