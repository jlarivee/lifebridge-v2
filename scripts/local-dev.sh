#!/bin/bash
# LifeBridge Local Dev — full local environment matching production
# Usage: bash scripts/local-dev.sh
# Stop:  Ctrl+C

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

PORT_NUM=${PORT:-5400}

echo ""
echo "================================================"
echo "  LIFEBRIDGE LOCAL DEVELOPMENT ENVIRONMENT"
echo "================================================"
echo ""

# ── Load environment ──────────────────────────────────────────────────────
if [ -f .env.local ]; then
  set -a
  source .env.local
  set +a
else
  echo "[ERROR] .env.local not found."
  echo "  Copy the template and add your ANTHROPIC_API_KEY."
  exit 1
fi

# Force local mode
export LOCAL_DEV=true
PORT_NUM=${PORT:-5400}

# ── Pre-flight checks ────────────────────────────────────────────────────

# Check port availability
if lsof -i :${PORT_NUM} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[ERROR] Port ${PORT_NUM} is already in use."
  echo "  Kill it with: lsof -ti :${PORT_NUM} | xargs kill -9"
  exit 1
fi

# Check required env vars
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "[ERROR] ANTHROPIC_API_KEY not set in .env.local"
  exit 1
fi

# Create data dir for local DB
mkdir -p data

# ── Dependency check ──────────────────────────────────────────────────────
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  echo "[SETUP] Installing dependencies..."
  npm install --ignore-scripts 2>/dev/null || true
else
  echo "[SETUP] Dependencies up to date"
fi

# ── Environment summary ──────────────────────────────────────────────────
echo ""
echo "  Environment:"
echo "    Port:        ${PORT_NUM}"
echo "    Database:    data/local-db.json (local file)"
echo "    Claude API:  ...${ANTHROPIC_API_KEY: -8} (set)"

if [ -n "$GITHUB_TOKEN" ]; then
  echo "    GitHub:      ACTIVE (commits enabled)"
else
  echo "    GitHub:      SKIPPED (no token — builder deploys locally only)"
fi

if [ -n "$GMAIL_USER" ] && [ -n "$GMAIL_APP_PASSWORD" ]; then
  echo "    Gmail:       ACTIVE ($GMAIL_USER)"
else
  echo "    Gmail:       SKIPPED (no credentials)"
fi

if [ -n "$SLACK_WEBHOOK_URL" ]; then
  echo "    Slack:       ACTIVE"
else
  echo "    Slack:       SKIPPED (no webhook)"
fi

if [ -n "$ITALY2026_URL" ]; then
  echo "    Italy 2026:  $ITALY2026_URL"
else
  echo "    Italy 2026:  SKIPPED (no URL)"
fi

echo ""
echo "  URLs:"
echo "    Hub:         http://localhost:${PORT_NUM}"
echo "    Registry:    http://localhost:${PORT_NUM}/registry"
echo "    Route:       http://localhost:${PORT_NUM}/route"
echo "    Builder:     http://localhost:${PORT_NUM}/builder/pending"
echo "    Tests:       http://localhost:${PORT_NUM}/test/run"
echo ""
echo "  Scripts:"
echo "    Health check:  bash scripts/local-health.sh"
echo "    Full tests:    bash scripts/local-test.sh"
echo ""
echo "================================================"
echo "  Starting LifeBridge..."
echo "================================================"
echo ""

# ── Start server ──────────────────────────────────────────────────────────
node src/index.js
