#!/bin/bash
# LifeBridge startup script
# Does NOT sync with GitHub on startup — the /webhooks/github endpoint
# handles all pulls automatically when you push to main.
# Doing git reset --hard here would wipe files deployed by the agent builder.

echo "═══════════════════════════════════════"
echo "LifeBridge — Starting server"
echo "Current: $(git log --oneline -1)"
echo "═══════════════════════════════════════"

# Kill any existing server on port 5000
fuser -k 5000/tcp 2>/dev/null || true

# Install deps if needed (silent)
npm install --silent 2>/dev/null

echo "Starting LifeBridge server..."
echo "═══════════════════════════════════════"
node src/index.js
