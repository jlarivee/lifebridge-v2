/**
 * LifeBridge Test Agent Verification — Database checks
 * Run with: node scripts/test-agent-verify.js
 * Must run inside Replit (needs @replit/database)
 */

import Database from "@replit/database";

const db = new Database();

async function get(key) {
  const val = await db.get(key);
  if (val === null || val === undefined) return null;
  try { return typeof val === "string" ? JSON.parse(val) : val; }
  catch { return val; }
}

async function list(prefix) {
  return (await db.list(prefix)) || [];
}

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════");
  console.log("  LifeBridge Test Agent — DB Verification");
  console.log("═══════════════════════════════════════");
  console.log("");

  let pass = 0;
  let fail = 0;

  // 1. Registry check
  console.log("── Registry ──");
  const registry = await get("registry");
  if (!registry) {
    console.log("  ❌ Registry not found in database");
    fail++;
  } else {
    const agents = registry.agents || [];
    const testAgent = agents.find(a => a.name === "test-agent");
    if (testAgent) {
      console.log(`  ✅ test-agent found in registry (status: ${testAgent.status})`);
      if (testAgent.status === "Active") {
        console.log("  ✅ Status is Active");
        pass += 2;
      } else {
        console.log(`  ❌ Status is "${testAgent.status}" — expected "Active"`);
        pass++; fail++;
      }
    } else {
      console.log("  ❌ test-agent NOT found in registry");
      console.log(`     Agents in registry: ${agents.map(a => a.name).join(", ") || "none"}`);
      fail++;
    }
    console.log(`  📋 Total agents registered: ${agents.length}`);
    for (const a of agents) {
      console.log(`     - ${a.name} (${a.domain}, ${a.status})`);
    }
  }

  // 2. Test suites
  console.log("");
  console.log("── Test Suites ──");
  const suiteKeys = await list("test-suite:");
  console.log(`  Found ${suiteKeys.length} test suite(s)`);
  if (suiteKeys.length > 0) {
    pass++;
    for (const key of suiteKeys) {
      const suite = await get(key);
      if (suite) {
        const cases = suite.test_cases || [];
        const hasBaseline = !!suite.baseline_output;
        console.log(`  📦 ${suite.agent_name}`);
        console.log(`     Cases: ${cases.length}`);
        console.log(`     Baseline: ${hasBaseline ? "captured at " + suite.baseline_captured_at : "not yet captured"}`);
        for (const tc of cases) {
          console.log(`     - [${tc.last_status || "pending"}] ${tc.input.slice(0, 60)}...`);
        }
      }
    }
  } else {
    console.log("  ⚠️  No test suites yet — run POST /test/run to create them");
  }

  // 3. Test runs
  console.log("");
  console.log("── Test Runs ──");
  const runKeys = await list("test-run:");
  console.log(`  Found ${runKeys.length} test run(s)`);
  if (runKeys.length > 0) {
    pass++;
    // Show last 5
    const runs = [];
    for (const key of runKeys) {
      const run = await get(key);
      if (run) runs.push(run);
    }
    runs.sort((a, b) => (b.run_at || "").localeCompare(a.run_at || ""));
    console.log("  Last 5 runs:");
    for (const run of runs.slice(0, 5)) {
      const icon = run.status === "pass" ? "✅" : run.status === "fail" ? "❌" : "⚠️";
      console.log(`     ${icon} ${run.agent_name} — ${run.status}${run.failure_type ? " (" + run.failure_type + ")" : ""} — ${run.duration_ms}ms — ${run.run_at}`);
    }
  } else {
    console.log("  ⚠️  No test runs yet — run POST /test/run to create them");
  }

  // 4. Warnings
  console.log("");
  console.log("── Warnings ──");
  const warnKeys = await list("agent-warning:");
  console.log(`  Found ${warnKeys.length} warning(s)`);
  if (warnKeys.length > 0) {
    for (const key of warnKeys) {
      const w = await get(key);
      if (w) {
        console.log(`  ⚠️  ${w.agent_name}: ${w.reason} — ${w.recommended_action}`);
      }
    }
  } else {
    console.log("  ✅ No warnings (clean)");
    pass++;
  }

  // 5. Build sessions (bonus check)
  console.log("");
  console.log("── Build Sessions ──");
  const buildKeys = await list("build-session:");
  console.log(`  Found ${buildKeys.length} build session(s)`);

  // Summary
  console.log("");
  console.log("═══════════════════════════════════════");
  console.log(`  RESULTS: ${pass} passed, ${fail} failed`);
  console.log("═══════════════════════════════════════");
  console.log("");

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error("Verification failed:", e.message);
  process.exit(1);
});
