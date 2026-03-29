#!/bin/bash
# LifeBridge Local Health Check — fast, no Claude API calls
# Run: bash scripts/local-health.sh
# Checks all subsystems are responsive in < 10 seconds

PORT=${PORT:-5400}
BASE="http://localhost:${PORT}"
PASS=0
FAIL=0
WARN=0

green() { echo -e "\033[32m  PASS  $1\033[0m"; PASS=$((PASS+1)); }
red()   { echo -e "\033[31m  FAIL  $1\033[0m"; FAIL=$((FAIL+1)); }
yellow(){ echo -e "\033[33m  WARN  $1\033[0m"; WARN=$((WARN+1)); }

echo ""
echo "================================================"
echo "  LIFEBRIDGE LOCAL HEALTH CHECK"
echo "  Target: $BASE"
echo "================================================"
echo ""

# ── 1. Server responding ─────────────────────────────────────────────────
HEALTH=$(curl -s -m 5 $BASE/registry 2>/dev/null)
if [ $? -eq 0 ] && echo "$HEALTH" | jq -e '.agents' >/dev/null 2>&1; then
  green "Server responding on port $PORT"
else
  red "Server not responding on port $PORT"
  echo ""
  echo "  Start the server first: bash scripts/local-dev.sh"
  echo ""
  exit 1
fi

# ── 2. Registry loaded ───────────────────────────────────────────────────
AGENTS=$(curl -s -m 5 $BASE/registry 2>/dev/null | jq -r '[.agents[].name] | length' 2>/dev/null)
NAMES=$(curl -s -m 5 $BASE/registry 2>/dev/null | jq -r '[.agents[].name] | join(", ")' 2>/dev/null)
if [ "$AGENTS" -gt 5 ] 2>/dev/null; then
  green "Registry: $AGENTS agents loaded"
else
  red "Registry: only ${AGENTS:-0} agents (expected 12)"
fi

# ── 3. Database responding ────────────────────────────────────────────────
CTX=$(curl -s -m 5 $BASE/context 2>/dev/null)
if echo "$CTX" | jq -e '.preferences' >/dev/null 2>&1; then
  green "Database: responding (context readable)"
else
  red "Database: not responding"
fi

# ── 4. Connector status ──────────────────────────────────────────────────
CONN=$(curl -s -m 5 $BASE/connectors/status 2>/dev/null)
GMAIL=$(echo "$CONN" | jq -r '.gmail.connected // false' 2>/dev/null)
SLACK=$(echo "$CONN" | jq -r '.slack.connected // false' 2>/dev/null)
if [ "$GMAIL" = "true" ]; then green "Gmail: connected"; else yellow "Gmail: not configured (optional)"; fi
if [ "$SLACK" = "true" ]; then green "Slack: connected"; else yellow "Slack: not configured (optional)"; fi

# ── 5. Builder endpoint ──────────────────────────────────────────────────
BUILDER=$(curl -s -m 5 $BASE/builder/pending 2>/dev/null)
if [ $? -eq 0 ]; then
  PENDING=$(echo "$BUILDER" | jq -r 'length // 0' 2>/dev/null)
  green "Builder: endpoint live (${PENDING:-0} pending)"
else
  red "Builder: endpoint not responding"
fi

# ── 6. Test endpoint ─────────────────────────────────────────────────────
TEST_EP=$(curl -s -m 5 $BASE/test/suites 2>/dev/null)
if [ $? -eq 0 ] && [ -n "$TEST_EP" ]; then
  green "Test suite: endpoint live"
else
  yellow "Test suite: endpoint not responding"
fi

# ── 7. Frontend serving ──────────────────────────────────────────────────
FRONTEND=$(curl -s -m 5 -o /dev/null -w "%{http_code}" $BASE/ 2>/dev/null)
if [ "$FRONTEND" = "200" ]; then
  green "Frontend: serving index.html"
else
  red "Frontend: HTTP $FRONTEND"
fi

# ── 8. Execution log ─────────────────────────────────────────────────────
ELOG=$(curl -s -m 5 $BASE/execution/log 2>/dev/null)
if [ $? -eq 0 ]; then
  green "Execution log: endpoint live"
else
  yellow "Execution log: not responding"
fi

# ── 9. Italy 2026 connector ──────────────────────────────────────────────
ITALY=$(curl -s -m 5 $BASE/italy2026/status 2>/dev/null)
if [ $? -eq 0 ] && [ -n "$ITALY" ]; then
  green "Italy 2026: connector responding"
else
  yellow "Italy 2026: connector not responding (optional)"
fi

# ── 10. Local DB file ────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
if [ -f "$PROJECT_DIR/data/local-db.json" ]; then
  DB_SIZE=$(wc -c < "$PROJECT_DIR/data/local-db.json" | tr -d ' ')
  DB_KEYS=$(jq 'keys | length' "$PROJECT_DIR/data/local-db.json" 2>/dev/null)
  green "Local DB: ${DB_KEYS:-?} keys, ${DB_SIZE} bytes"
else
  yellow "Local DB: file not found (will be created on first write)"
fi

# ── Summary ───────────────────────────────────────────────────────────────
echo ""
echo "================================================"
echo "  RESULTS: $PASS passed, $WARN warnings, $FAIL failed"
echo "================================================"

if [ $FAIL -eq 0 ]; then
  echo -e "\n\033[32m  ALL SYSTEMS OPERATIONAL\033[0m"
  echo "  Agents: $NAMES"
  echo ""
  exit 0
else
  echo -e "\n\033[31m  $FAIL CHECK(S) FAILED\033[0m"
  echo ""
  exit 1
fi
