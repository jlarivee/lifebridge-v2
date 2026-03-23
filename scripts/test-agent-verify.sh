#!/bin/bash
# LifeBridge Test Agent Verification — curl checks
# Run with: bash scripts/test-agent-verify.sh
# Requires the server to be running on localhost:5000

BASE="http://localhost:5000"
PASS=0
FAIL=0

check() {
  local name="$1"
  local url="$2"
  local method="${3:-GET}"

  if [ "$method" = "POST" ]; then
    RESP=$(curl -s -w "\n%{http_code}" -X POST "$url")
  else
    RESP=$(curl -s -w "\n%{http_code}" "$url")
  fi

  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')

  if [ "$CODE" = "200" ]; then
    echo "  ✅ $name — HTTP $CODE"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $name — HTTP $CODE"
    echo "     Response: $(echo "$BODY" | head -c 200)"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "═══════════════════════════════════════"
echo "  LifeBridge Test Agent Verification"
echo "═══════════════════════════════════════"
echo ""

echo "── Endpoint Checks ──"
check "GET /test/suites" "$BASE/test/suites"
check "GET /test/runs" "$BASE/test/runs"
check "GET /test/warnings" "$BASE/test/warnings"
check "GET /test/verify" "$BASE/test/verify"
check "GET /registry" "$BASE/registry"

echo ""
echo "── Self-Verification ──"
VERIFY=$(curl -s "$BASE/test/verify")
OVERALL=$(echo "$VERIFY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('overall','?'))" 2>/dev/null)
if [ "$OVERALL" = "pass" ]; then
  echo "  ✅ /test/verify reports: PASS"
  PASS=$((PASS + 1))
else
  echo "  ❌ /test/verify reports: $OVERALL"
  echo "     Issues: $(echo "$VERIFY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('issues',[]))" 2>/dev/null)"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "── Full Test Suite Run ──"
echo "  Running POST /test/run (this calls the Anthropic API, may take 30-60s)..."
RUN_RESP=$(curl -s -X POST "$BASE/test/run")
RUN_PASSED=$(echo "$RUN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('passed',0))" 2>/dev/null)
RUN_FAILED=$(echo "$RUN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('failed',0))" 2>/dev/null)
RUN_ERRORS=$(echo "$RUN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('errors',0))" 2>/dev/null)
RUN_TOTAL=$(echo "$RUN_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin).get('total_cases',0))" 2>/dev/null)

if [ "$RUN_TOTAL" != "0" ] && [ "$RUN_TOTAL" != "" ]; then
  echo "  Results: $RUN_PASSED/$RUN_TOTAL passed, $RUN_FAILED failed, $RUN_ERRORS errors"
  if [ "$RUN_FAILED" = "0" ] && [ "$RUN_ERRORS" = "0" ]; then
    echo "  ✅ Full suite PASSED"
    PASS=$((PASS + 1))
  else
    echo "  ⚠️  Some tests failed — review output above"
    FAIL=$((FAIL + 1))
  fi
else
  echo "  ⚠️  No test cases ran (no agents registered or no test suites)"
  echo "     Raw response: $(echo "$RUN_RESP" | head -c 300)"
fi

echo ""
echo "── Post-Run Database Check ──"
SUITES=$(curl -s "$BASE/test/suites")
SUITE_COUNT=$(echo "$SUITES" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
echo "  Test suites in DB: ${SUITE_COUNT:-0}"

RUNS=$(curl -s "$BASE/test/runs")
RUN_COUNT=$(echo "$RUNS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
echo "  Test runs in DB: ${RUN_COUNT:-0}"

WARNS=$(curl -s "$BASE/test/warnings")
WARN_COUNT=$(echo "$WARNS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
echo "  Warnings in DB: ${WARN_COUNT:-0}"

echo ""
echo "═══════════════════════════════════════"
echo "  RESULTS: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════"
echo ""
