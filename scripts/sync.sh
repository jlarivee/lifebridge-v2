#!/bin/bash
# LifeBridge Sync & Test — run after every Claude Code push
# Usage: bash scripts/sync.sh

echo "═══ SYNC ═══"
git fetch origin && git reset --hard origin/main
npm install --silent 2>/dev/null

echo ""
echo "═══ RESET TEST SUITES ═══"
node -e "
import Database from '@replit/database';
const db = new Database();
const keys = await db.list('test-suite:');
for (const key of keys) { await db.delete(key); }
console.log('Deleted ' + keys.length + ' test suite(s) — will re-seed on restart');
"

echo ""
echo "═══ RESTART ═══"
echo "Killing server..."
pkill -f "node src/index.js" 2>/dev/null || true
sleep 1
echo "Starting server..."
node src/index.js &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait for server to be ready
echo "Waiting for server..."
for i in $(seq 1 30); do
  if curl -s http://localhost:5000/registry > /dev/null 2>&1; then
    echo "Server ready!"
    break
  fi
  sleep 1
done

echo ""
echo "═══ RUN TESTS ═══"
curl -s -X POST http://localhost:5000/test/run | node -e "
process.stdin.on('data', d => {
  const r = JSON.parse(d);
  console.log('Agents tested:', r.agents_tested);
  console.log('Total cases:', r.total_cases);
  console.log('Passed:', r.passed);
  console.log('Failed:', r.failed);
  console.log('Errors:', r.errors);
  console.log('Duration:', Math.round(r.duration_ms/1000) + 's');
  console.log('');
  if (r.failed > 0 || r.errors > 0) {
    console.log('FAILURES:');
    (r.results || []).filter(t => t.status !== 'pass').forEach(t => {
      console.log('  ❌', t.agent_name, t.failure_type || t.status, t.notes || '');
    });
  } else {
    console.log('✅ ALL TESTS PASSING');
  }
});
"
