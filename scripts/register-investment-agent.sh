#!/bin/bash
# Register investment-research-agent in the LifeBridge registry
# Run on Replit after deploying: bash scripts/register-investment-agent.sh

echo "=== Registering Investment Research Agent ==="

# Register via the system endpoint
RESP=$(curl -s -X POST http://localhost:5000/system/register-agent \
  -H "Content-Type: application/json" \
  -d '{
    "name": "investment-research-agent",
    "domain": "Personal Life",
    "status": "Active",
    "purpose": "Paper trading, watchlists, stock research, and virtual portfolio management",
    "trigger_patterns": ["invest", "stock", "trade", "portfolio", "watchlist", "market", "ticker", "buy", "sell", "research AAPL", "research NVDA", "paper trade", "P&L"],
    "tools": ["web_search", "structured_reasoning"],
    "connectors": [],
    "requires_approval": false
  }')

echo "$RESP" | jq '.' 2>/dev/null || echo "$RESP"

echo ""
echo "=== Seeding test suite ==="
curl -s -X POST http://localhost:5000/test/seed | jq '.' 2>/dev/null

echo ""
echo "=== Running fast tests for investment-research-agent ==="
curl -s -X POST http://localhost:5000/test/run/investment-research-agent | jq '{passed, failed, errors}' 2>/dev/null

echo ""
echo "=== Done ==="
