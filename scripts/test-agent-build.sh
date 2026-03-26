#!/bin/bash
# LifeBridge — Test the full autonomous agent build pipeline
# Run: bash scripts/test-agent-build.sh

BASE="http://localhost:5000"
echo "═══════════════════════════════════════"
echo "  TESTING AUTONOMOUS AGENT BUILD"
echo "═══════════════════════════════════════"

echo ""
echo "Step 1: Sending build request to master agent..."
ROUTE=$(curl -s -X POST $BASE/route \
  -H "Content-Type: application/json" \
  -d '{"input": "Build a new agent called three-rivers-social-agent. Purpose: create Instagram and Facebook draft posts for Three Rivers Slab wood slabs with inventory data. Domain: Personal Business. Drafts only, no auto-posting. Pull data from slab-inventory-tracker-agent."}')

CONF=$(echo "$ROUTE" | jq -r '.confidence // 0')
SESSION=$(echo "$ROUTE" | jq -r '.build_session.session_id // empty')
PHASE=$(echo "$ROUTE" | jq -r '.build_session.phase // empty')

if [ -z "$SESSION" ]; then
  echo "❌ No build session created. Confidence: $CONF"
  echo "Response: $(echo "$ROUTE" | jq -r '.response' | head -c 200)"
  exit 1
fi

echo "✅ BUILD BRIEF dispatched → Session: $SESSION"
echo "   Confidence: $CONF | Phase: $PHASE"

echo ""
echo "Step 2: Approving Phase 1 (skill file)..."
sleep 2
P1=$(curl -s -X POST $BASE/agents/builder/continue \
  -H "Content-Type: application/json" \
  -d "{\"session_id\": \"$SESSION\", \"message\": \"Approved. Proceed to Phase 2.\"}")
P1_PHASE=$(echo "$P1" | jq -r '.phase // "unknown"')
echo "   Phase: $P1_PHASE"

if [ "$P1_PHASE" = "phase-2-review" ]; then
  echo "✅ Phase 1 approved → Code generated"
else
  echo "⚠️  Unexpected phase: $P1_PHASE"
fi

echo ""
echo "Step 3: Approving Phase 2 (code) → validation + deployment..."
sleep 2
P2=$(curl -s -X POST $BASE/agents/builder/continue \
  -H "Content-Type: application/json" \
  -d "{\"session_id\": \"$SESSION\", \"message\": \"Approved. Proceed to Phase 3 validation and Phase 4 deployment.\"}")
P2_PHASE=$(echo "$P2" | jq -r '.phase // "unknown"')
DEPLOYED=$(echo "$P2" | jq -r '.deploy_result.deployed // false')
AGENT_NAME=$(echo "$P2" | jq -r '.deploy_result.agent // "unknown"')

echo "   Phase: $P2_PHASE"
echo "   Deployed: $DEPLOYED"
echo "   Agent: $AGENT_NAME"

if [ "$DEPLOYED" = "true" ]; then
  echo "✅ AGENT DEPLOYED SUCCESSFULLY"
else
  echo "⚠️  Deploy result: $(echo "$P2" | jq -c '.deploy_result')"
fi

echo ""
echo "Step 4: Verifying files exist..."
sleep 1
if [ -f "src/agents/three-rivers-social-agent.js" ]; then
  echo "✅ Code file: src/agents/three-rivers-social-agent.js"
else
  echo "❌ Code file NOT found"
fi
if [ -f "src/skills/three-rivers-social-agent.md" ]; then
  echo "✅ Skill file: src/skills/three-rivers-social-agent.md"
else
  echo "❌ Skill file NOT found"
fi

echo ""
echo "Step 5: Testing the new agent..."
sleep 1
TEST=$(curl -s -X POST $BASE/agents/three-rivers-social-agent \
  -H "Content-Type: application/json" \
  -d '{"input": "Generate 2 draft Instagram posts for our best walnut slabs"}' 2>/dev/null)
TEST_AGENT=$(echo "$TEST" | jq -r '.agent // "null"')
TEST_OUT=$(echo "$TEST" | jq -r '.output // "null"' | head -c 200)

if [ "$TEST_AGENT" != "null" ] && [ "$TEST_AGENT" != "" ]; then
  echo "✅ Agent responded: $TEST_AGENT"
  echo "   Output: $TEST_OUT..."
else
  echo "⚠️  Agent returned null — may need server restart for hot-reload"
  echo "   Run: fuser -k 5000/tcp; sleep 1; node src/index.js"
  echo "   Then: curl -s -X POST $BASE/agents/three-rivers-social-agent -H 'Content-Type: application/json' -d '{\"input\": \"Generate 2 draft posts\"}' | jq '{agent, output}'"
fi

echo ""
echo "Step 6: Checking execution log..."
ELOG=$(curl -s $BASE/execution/log | jq '.[0]')
echo "   Latest: $(echo "$ELOG" | jq -r '.description // "none"')"

echo ""
echo "═══════════════════════════════════════"
echo "  BUILD PIPELINE TEST COMPLETE"
echo "═══════════════════════════════════════"
