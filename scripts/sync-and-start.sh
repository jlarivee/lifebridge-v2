#!/bin/bash
# LifeBridge startup script
# Syncs with GitHub only if no local changes exist

echo "═══════════════════════════════════════"

# Kill any existing server on port 5000
fuser -k 5000/tcp 2>/dev/null || true

# Only sync from GitHub if there are no local uncommitted changes
if git diff --quiet 2>/dev/null && git diff --cached --quiet 2>/dev/null; then
  echo "LifeBridge — Syncing with GitHub..."
  echo "═══════════════════════════════════════"
  git fetch origin 2>/dev/null
  git reset --hard origin/main
  echo "Synced to: $(git log --oneline -1)"
else
  echo "LifeBridge — Local changes detected, skipping git sync"
  echo "═══════════════════════════════════════"
  echo "Current: $(git log --oneline -1)"
fi

# Install deps if needed (silent)
npm install --silent 2>/dev/null

echo "═══════════════════════════════════════"
echo "Starting LifeBridge server..."
echo "═══════════════════════════════════════"
node src/index.js
