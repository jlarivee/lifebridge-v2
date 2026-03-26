#!/bin/bash
# One-time fix: update walnut slab cut_dates from 2024-03-01 to 2026-03-01
# Run on Replit: bash scripts/fix-slab-dates.sh

echo "=== Slab Cut Date Fix ==="
echo "Fixing walnut entries: 2024-03-01 → 2026-03-01"
echo ""

# Use the running server's API to fix via the slab agent
RESP=$(curl -s -X POST http://localhost:5000/agents/slab-inventory-tracker-agent \
  -H "Content-Type: application/json" \
  -d '{
    "request": "Update all walnut slabs that have cut_date of 2024-03-01 to 2026-03-01. These were entered incorrectly. Return the full updated inventory as JSON.",
    "context": { "system_action": "date_correction" }
  }')

echo "$RESP" | jq '.output' 2>/dev/null || echo "$RESP"
echo ""
echo "=== Done. Verify with: ==="
echo "curl -s -X POST http://localhost:5000/agents/slab-inventory-tracker-agent -H 'Content-Type: application/json' -d '{\"request\": \"show all walnut slabs\", \"context\": {}}' | jq '.output'"
