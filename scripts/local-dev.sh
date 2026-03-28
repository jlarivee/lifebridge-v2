#!/bin/bash
# LifeBridge Local Dev — start server with local file-based DB
# Usage: bash scripts/local-dev.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

# Load .env.local
if [ -f .env.local ]; then
  echo "[LOCAL-DEV] Loading .env.local"
  set -a
  source .env.local
  set +a
else
  echo "[LOCAL-DEV] ERROR: .env.local not found. Copy the template and add your ANTHROPIC_API_KEY."
  exit 1
fi

# Ensure LOCAL_DEV is set
export LOCAL_DEV=true

# Create data dir for local DB
mkdir -p data

# Install deps (skip @replit/database errors gracefully)
echo "[LOCAL-DEV] Installing dependencies..."
npm install --ignore-scripts 2>/dev/null || true

# Start server
echo "[LOCAL-DEV] Starting LifeBridge on port ${PORT:-5000}..."
node src/index.js
