#!/bin/bash
# LifeBridge startup script
# Does NOT sync with GitHub on startup — the /webhooks/github endpoint
# handles all pulls automatically when you push to main.
# Doing git reset --hard here would wipe files deployed by the agent builder.

echo "═══════════════════════════════════════"
echo "LifeBridge — Starting server"
echo "Current: $(git log --oneline -1)"
echo "═══════════════════════════════════════"

# Configure git identity from Replit secrets so builder commits work
if [ -n "$GIT_AUTHOR_NAME" ]; then
  git config --global user.name "$GIT_AUTHOR_NAME"
  git config --global user.email "$GIT_AUTHOR_EMAIL"
  echo "Git identity: $GIT_AUTHOR_NAME <$GIT_AUTHOR_EMAIL>"
fi

# Kill any existing server on port 5000
fuser -k 5000/tcp 2>/dev/null || true
pkill -f "node src/index.js" 2>/dev/null || true

# Install deps if needed (silent)
npm install --silent 2>/dev/null

echo "Starting LifeBridge server..."
echo "═══════════════════════════════════════"
node src/index.js
