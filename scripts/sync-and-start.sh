#!/bin/bash
# LifeBridge startup script
# Always runs latest code from GitHub before starting server

echo "═══════════════════════════════════════"
echo "LifeBridge — Syncing with GitHub..."
echo "═══════════════════════════════════════"

# Kill any existing server on port 5000
fuser -k 5000/tcp 2>/dev/null || true

# Always pull latest from GitHub
git fetch origin 2>/dev/null
git reset --hard origin/main
echo "Synced to: $(git log --oneline -1)"

# Install deps if needed (silent)
npm install --silent 2>/dev/null

echo "═══════════════════════════════════════"
echo "Starting LifeBridge server..."
echo "═══════════════════════════════════════"
node src/index.js
