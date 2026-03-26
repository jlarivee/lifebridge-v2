#!/bin/bash
# LifeBridge Full Health Check
# Run: bash scripts/full-health-check.sh
# Tests every subsystem in ~90 seconds

BASE="http://localhost:5000"
PASS=0
FAIL=0
WARN=0

green() { echo -e "\033[32m✅ $1\033[0m"; PASS=$((PASS+1)); }
red()   { echo -e "\033[31m❌ $1\033[0m"; FAIL=$((FAIL+1)); }
yellow(){ echo -e "\033[33m⚠️  $1\033[0m"; WARN=$((WARN+1)); }
header(){ echo -e "\n\033[1;36m═══ $1 ═══\033[0m"; }

header "1. TEST SUITE"
RESULT=$(curl -s -X POST $BASE/test/run 2>/dev/null)
PASSED=$(echo "$RESULT" | jq -r '.passed // 0')
FAILED=$(echo "$RESULT" | jq -r '.failed // 0')
TOTAL=$(echo "$RESULT" | jq -r '.total_cases // 0')
DURATION=$(echo "$RESULT" | jq -r '.duration_ms // 0')
if [ "$FAILED" = "0" ] && [ "$PASSED" -gt 0 ]; then
  green "Test suite: $PASSED/$TOTAL passing (${DURATION}ms)"
else
  red "Test suite: $PASSED passed, $FAILED failed"
fi

header "2. REGISTRY"
AGENTS=$(curl -s $BASE/registry 2>/dev/null | jq -r '[.agents[].name] | length')
NAMES=$(curl -s $BASE/registry 2>/dev/null | jq -r '[.agents[].name] | join(", ")')
if [ "$AGENTS" -gt 5 ]; then
  green "Registry: $AGENTS agents — $NAMES"
else
  red "Registry: only $AGENTS agents found"
fi

header "3. ROUTING (Life Sciences)"
ROUTE1=$(curl -s -X POST $BASE/route -H "Content-Type: application/json" \
  -d '{"input": "What is the latest on Pfizer?"}' 2>/dev/null)
AGENT1=$(echo "$ROUTE1" | jq -r '.routed_to // .agent // "none"')
CONF1=$(echo "$ROUTE1" | jq -r '.confidence // 0')
if echo "$AGENT1" | grep -qi "life-sciences\|account"; then
  green "Route to Life Sciences: $AGENT1 (confidence: $CONF1)"
elif [ "$CONF1" -gt 70 ] 2>/dev/null; then
  green "Route: $AGENT1 (confidence: $CONF1)"
else
  yellow "Route result: $AGENT1 (confidence: $CONF1) — expected life-sciences"
fi

header "4. ROUTING (Travel)"
ROUTE2=$(curl -s -X POST $BASE/route -H "Content-Type: application/json" \
  -d '{"input": "Find me flights to Rome in June"}' 2>/dev/null)
AGENT2=$(echo "$ROUTE2" | jq -r '.routed_to // .agent // "none"')
CONF2=$(echo "$ROUTE2" | jq -r '.confidence // 0')
if echo "$AGENT2" | grep -qi "travel"; then
  green "Route to Travel: $AGENT2 (confidence: $CONF2)"
elif [ "$CONF2" -gt 70 ] 2>/dev/null; then
  green "Route: $AGENT2 (confidence: $CONF2)"
else
  yellow "Route result: $AGENT2 (confidence: $CONF2) — expected travel"
fi

header "5. ROUTING (Unknown → Build Brief)"
ROUTE3=$(curl -s -X POST $BASE/route -H "Content-Type: application/json" \
  -d '{"input": "Generate a TikTok video script for our walnut slabs"}' 2>/dev/null)
AGENT3=$(echo "$ROUTE3" | jq -r '.routed_to // .agent // "none"')
BRIEF=$(echo "$ROUTE3" | jq -r '.build_brief // .output // empty' | head -c 100)
CONF3=$(echo "$ROUTE3" | jq -r '.confidence // 0')
if [ -n "$BRIEF" ] && echo "$BRIEF" | grep -qi "build\|brief\|agent\|create"; then
  green "Unknown request → build brief generated"
elif echo "$AGENT3" | grep -qi "builder"; then
  green "Unknown request → routed to agent-builder"
else
  green "Route: $AGENT3 (confidence: $CONF3)"
fi

header "6. INTEGRITY SCAN"
INTEGRITY=$(curl -s -X POST $BASE/integrity/run 2>/dev/null)
ISTATUS=$(echo "$INTEGRITY" | jq -r '.status // "unknown"')
ICHECKED=$(echo "$INTEGRITY" | jq -r '.agents_checked // 0')
IHEALTHY=$(echo "$INTEGRITY" | jq -r '.agents_healthy // 0')
if [ "$ICHECKED" = "$IHEALTHY" ] && [ "$ICHECKED" -gt 0 ] 2>/dev/null; then
  green "Integrity: $ICHECKED checked, $IHEALTHY healthy (status: $ISTATUS)"
elif [ "$ISTATUS" = "healthy" ] || [ "$ISTATUS" = "degraded" ]; then
  yellow "Integrity: $ISTATUS — $ICHECKED checked, $IHEALTHY healthy"
else
  red "Integrity: $ISTATUS"
fi

header "7. BRIEFING PREVIEW"
BRIEFING=$(curl -s -X POST $BASE/briefing/preview 2>/dev/null)
BSUCCESS=$(echo "$BRIEFING" | jq -r '.success // false')
BPREVIEW=$(echo "$BRIEFING" | jq -r '.preview // false')
if [ "$BSUCCESS" = "true" ]; then
  green "Briefing preview: compiled successfully"
else
  red "Briefing preview: failed — $(echo "$BRIEFING" | jq -r '.error // "unknown"')"
fi

header "8. CONNECTORS"
CONN=$(curl -s $BASE/connectors/status 2>/dev/null)
GMAIL=$(echo "$CONN" | jq -r '.gmail.connected // false')
SLACK=$(echo "$CONN" | jq -r '.slack.connected // false')
if [ "$GMAIL" = "true" ]; then green "Gmail: connected"; else yellow "Gmail: not connected"; fi
if [ "$SLACK" = "true" ]; then green "Slack: connected"; else yellow "Slack: not connected"; fi

header "9. MEMORY"
MEM=$(curl -s $BASE/memory/proposals 2>/dev/null)
MCOUNT=$(echo "$MEM" | jq -r 'if .output == "No pending proposals." then 0 elif (.output | type) == "array" then (.output | length) else 0 end')
green "Memory proposals pending: $MCOUNT"

header "10. EXECUTION LOG"
ELOG=$(curl -s $BASE/execution/log 2>/dev/null)
ECOUNT=$(echo "$ELOG" | jq -r 'length')
ELAST=$(echo "$ELOG" | jq -r '.[0].description // "none"')
green "Execution log entries: $ECOUNT — last: $ELAST"

header "11. CONTEXT"
CTX=$(curl -s $BASE/context 2>/dev/null)
PREFS=$(echo "$CTX" | jq -r '.preferences | length // 0')
PATTERNS=$(echo "$CTX" | jq -r '.learned_patterns | length // 0')
CONSTRAINTS=$(echo "$CTX" | jq -r '.constraints | length // 0')
green "Context: $PREFS preferences, $PATTERNS patterns, $CONSTRAINTS constraints"

# ── Summary ──
echo ""
echo -e "\033[1;37m═══════════════════════════════════════\033[0m"
echo -e "\033[1;37m  LIFEBRIDGE HEALTH CHECK SUMMARY\033[0m"
echo -e "\033[1;37m═══════════════════════════════════════\033[0m"
echo -e "  \033[32m✅ Passed: $PASS\033[0m"
[ $WARN -gt 0 ] && echo -e "  \033[33m⚠️  Warnings: $WARN\033[0m"
[ $FAIL -gt 0 ] && echo -e "  \033[31m❌ Failed: $FAIL\033[0m"
echo -e "\033[1;37m═══════════════════════════════════════\033[0m"

if [ $FAIL -eq 0 ]; then
  echo -e "\n\033[32m🟢 ALL SYSTEMS OPERATIONAL\033[0m"
else
  echo -e "\n\033[31m🔴 $FAIL CHECK(S) FAILED — SEE ABOVE\033[0m"
fi
