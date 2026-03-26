/**
 * LifeBridge Test Agent
 * Verifies spoke agents via structured test suites, baseline comparison,
 * and trend tracking. Runs daily, on deploy, and on demand.
 */

import { v4 as uuidv4 } from "uuid";
import * as db from "../db.js";
import { readRegistry } from "../tools/registry-tools.js";
import { sendSystemAlert } from "./connectors.js";

const STATIC_AGENTS = new Set(["test-agent"]);
const FAST_TIMEOUT_MS = 5000;   // Fast tier: local endpoints only, 5s is generous
const FULL_TIMEOUT_MS = 30000;  // Full tier: Claude API + external services
const PORT = process.env.PORT || 5000;

// ── Test Suite Management ───────────────────────────────────────────────────

export async function getTestSuite(agentName) {
  return await db.get(`test-suite:${agentName}`);
}

// Default test cases — tier: "fast" (no Claude calls) or "full" (invokes Claude API)
const DEFAULT_CASES = {
  "life-sciences-account-agent": [
    { tier: "fast", input: "Health: life-sciences-account-agent", type: "endpoint", method: "GET", path: "/agents/life-sciences-account-agent/health", expect_status: 200, expect_fields: ["status", "agent"] },
  ],
  "agent-builder-agent": [
    { tier: "fast", input: "Health: agent-builder-agent", type: "endpoint", method: "GET", path: "/agents/agent-builder-agent/health", expect_status: 200, expect_fields: ["status", "agent"] },
  ],
  "slab-inventory-tracker-agent": [
    { tier: "fast", input: "Health: slab-inventory-tracker-agent", type: "endpoint", method: "GET", path: "/agents/slab-inventory-tracker-agent/health", expect_status: 200, expect_fields: ["status", "agent"] },
    { tier: "full", input: "Action: show inventory status", type: "endpoint", method: "POST", path: "/agents/slab-inventory-tracker-agent", expect_status: 200, expect_fields: ["success", "action_taken", "output", "agent"], body: { request: "show me current inventory status" } },
  ],
  "registry-integrity-agent": [
    { tier: "fast", input: "GET /integrity/reports/latest", type: "endpoint", method: "GET", path: "/integrity/reports/latest", expect_status: 200 },
    { tier: "full", input: "POST /integrity/run", type: "endpoint", method: "POST", path: "/integrity/run", expect_status: 200, expect_fields: ["report_id", "status", "agents_checked"] },
  ],
  "test-agent": [
    { tier: "fast", input: "GET /test/suites", type: "endpoint", method: "GET", path: "/test/suites", expect_status: 200 },
    { tier: "fast", input: "GET /test/warnings", type: "endpoint", method: "GET", path: "/test/warnings", expect_status: 200 },
    { tier: "fast", input: "GET /test/verify", type: "endpoint", method: "GET", path: "/test/verify", expect_status: 200, expect_fields: ["overall"] },
  ],
  "intelligence-update-agent": [
    { tier: "fast", input: "GET /intelligence/status", type: "endpoint", method: "GET", path: "/intelligence/status", expect_status: 200, expect_fields: ["status", "agent"] },
    { tier: "fast", input: "GET /intelligence/findings", type: "endpoint", method: "GET", path: "/intelligence/findings", expect_status: 200 },
    { tier: "fast", input: "GET /intelligence/sources", type: "endpoint", method: "GET", path: "/intelligence/sources", expect_status: 200 },
    { tier: "full", input: "Action: list pending proposals", type: "endpoint", method: "POST", path: "/agents/intelligence-update-agent", expect_status: 200, expect_fields: ["success", "action_taken", "output", "agent"], body: { request: "list pending proposals" } },
  ],
  "memory-consolidation-agent": [
    { tier: "fast", input: "Memory: health check", type: "endpoint", method: "GET", path: "/agents/memory-consolidation-agent/health", expect_status: 200, expect_fields: ["status", "agent"] },
    { tier: "fast", input: "Memory: GET proposals", type: "endpoint", method: "GET", path: "/memory/proposals", expect_status: 200, expect_fields: ["agent", "output", "success"] },
    { tier: "fast", input: "Memory: GET facts", type: "endpoint", method: "GET", path: "/memory/facts", expect_status: 200, expect_fields: ["agent", "output", "success"] },
    { tier: "fast", input: "Memory: GET history", type: "endpoint", method: "GET", path: "/memory/history", expect_status: 200, expect_fields: ["agent", "output", "success"] },
    { tier: "full", input: "Memory: POST run consolidation", type: "endpoint", method: "POST", path: "/memory/run", expect_status: 200, expect_fields: ["agent", "output", "success"] },
  ],
  "travel-agent": [
    { tier: "fast", input: "Travel: health check", type: "endpoint", method: "GET", path: "/agents/travel-agent/health", expect_status: 200, expect_fields: ["status", "agent"] },
    { tier: "fast", input: "Travel: GET profile", type: "endpoint", method: "GET", path: "/travel/profile", expect_status: 200, expect_fields: ["home_airports", "airline_preference", "hotel_programs", "car_rental"] },
    { tier: "full", input: "Travel: plan Indianapolis work trip", type: "endpoint", method: "POST", path: "/agents/travel-agent", expect_status: 200, expect_fields: ["success", "agent", "output"], body: { request: "plan a trip to Indianapolis next week for an AWS meeting, 2 nights" } },
    { tier: "full", input: "Travel: loyalty point balances", type: "endpoint", method: "POST", path: "/agents/travel-agent", expect_status: 200, expect_fields: ["success", "agent", "output"], body: { request: "what are my current loyalty point balances" } },
    { tier: "full", input: "Travel: set flight watch BDL-ZRH", type: "endpoint", method: "POST", path: "/agents/travel-agent", expect_status: 200, expect_fields: ["success", "agent", "output"], body: { request: "set up a flight watch for BDL to ZRH under $2000 business class" } },
    { tier: "fast", input: "Travel: GET flight watches", type: "endpoint", method: "GET", path: "/travel/flights/watch", expect_status: 200 },
    { tier: "full", input: "Travel: plan Italy trip", type: "endpoint", method: "POST", path: "/agents/travel-agent", expect_status: 200, expect_fields: ["success", "agent", "output"], body: { request: "help me plan my Italy trip" } },
    { tier: "fast", input: "Travel: GET docs", type: "endpoint", method: "GET", path: "/travel/docs", expect_status: 200 },
    { tier: "fast", input: "Travel: GET trips", type: "endpoint", method: "GET", path: "/travel/trips", expect_status: 200 },
    { tier: "full", input: "Travel: NYC concert hotel", type: "endpoint", method: "POST", path: "/agents/travel-agent", expect_status: 200, expect_fields: ["success", "agent", "output"], body: { request: "I have a concert in NYC this weekend, find me a hotel near Madison Square Garden" } },
  ],
  "investment-research-agent": [
    { tier: "fast", input: "Investment: health check", type: "endpoint", method: "GET", path: "/agents/investment-research-agent/health", expect_status: 200, expect_fields: ["status", "agent"] },
    { tier: "fast", input: "Investment: GET watchlist", type: "endpoint", method: "GET", path: "/investment/watchlist", expect_status: 200, expect_fields: ["agent", "output", "success"] },
    { tier: "fast", input: "Investment: GET portfolio", type: "endpoint", method: "GET", path: "/investment/portfolio", expect_status: 200, expect_fields: ["agent", "output", "success"] },
    { tier: "fast", input: "Investment: GET trades", type: "endpoint", method: "GET", path: "/investment/trades", expect_status: 200, expect_fields: ["agent", "output", "success"] },
    { tier: "fast", input: "Investment: GET summary", type: "endpoint", method: "GET", path: "/investment/summary", expect_status: 200, expect_fields: ["agent", "output", "success"] },
    { tier: "full", input: "Investment: research AAPL", type: "endpoint", method: "POST", path: "/agents/investment-research-agent", expect_status: 200, expect_fields: ["success", "action_taken", "output", "agent"], body: { request: "research AAPL — give me a quick fundamental snapshot" } },
  ],
  "morning-briefing-agent": [
    { tier: "fast", input: "Briefing: health check", type: "endpoint", method: "GET", path: "/agents/morning-briefing-agent/health", expect_status: 200, expect_fields: ["status", "agent"] },
    { tier: "fast", input: "Briefing: GET latest", type: "endpoint", method: "GET", path: "/briefing/latest", expect_status: 200, expect_fields: ["agent", "output", "success"] },
    { tier: "full", input: "Briefing: POST preview", type: "endpoint", method: "POST", path: "/briefing/preview", expect_status: 200, expect_fields: ["agent", "output", "success"] },
    { tier: "full", input: "Briefing: POST run", type: "endpoint", method: "POST", path: "/briefing/run", expect_status: 200, expect_fields: ["agent", "output", "success"] },
    { tier: "fast", input: "Briefing: GET history", type: "endpoint", method: "GET", path: "/briefing/history", expect_status: 200 },
  ],
  "connectors": [
    { tier: "fast", input: "Connectors: health", type: "endpoint", method: "GET", path: "/agents/connectors/health", expect_status: 200, expect_fields: ["status", "agent"] },
    { tier: "full", input: "Connectors: GET status", type: "endpoint", method: "GET", path: "/connectors/status", expect_status: 200, expect_fields: ["gmail", "slack"] },
    { tier: "full", input: "Connectors: test gmail", type: "endpoint", method: "POST", path: "/connectors/test", expect_status: 200, expect_fields: ["success", "connector", "latency_ms"], body: { connector: "gmail" } },
    { tier: "full", input: "Connectors: test slack", type: "endpoint", method: "POST", path: "/connectors/test", expect_status: 200, expect_fields: ["success", "connector", "latency_ms"], body: { connector: "slack" } },
    { tier: "full", input: "Connectors: gmail send", type: "endpoint", method: "POST", path: "/connectors/gmail/send", expect_status: 200, expect_fields: ["success", "connector", "message_id"], body: { to: "josh@test.com", subject: "LifeBridge Test", body: "Connector test", require_approval: false } },
    { tier: "full", input: "Connectors: slack send", type: "endpoint", method: "POST", path: "/connectors/slack/send", expect_status: 200, expect_fields: ["success", "connector", "timestamp"], body: { channel: "#lifebridge-alerts", message: "LifeBridge connector test", require_approval: false } },
  ],
  "agent-lifecycle": [
    { tier: "fast", input: "Lifecycle: GET agent detail", type: "endpoint", method: "GET", path: "/agents/life-sciences-account-agent/detail", expect_status: 200, expect_fields: ["agent", "skill_file", "code_file", "test_suite", "status"] },
    { tier: "fast", input: "Lifecycle: PUT skill update", type: "endpoint", method: "PUT", path: "/agents/test-deletion-agent/skill", expect_status: 200, expect_fields: ["success", "agent", "updated_at", "version_saved"], body: { content: "# lifecycle test skill — safe to overwrite" }, pre_db_setup: { key: "test-deletion-agent", agent: { name: "test-deletion-agent", domain: "System", status: "Active", trigger_patterns: ["test"], purpose: "Temporary" } } },
    { tier: "fast", input: "Lifecycle: POST pause agent", type: "endpoint", method: "POST", path: "/agents/life-sciences-account-agent/pause", expect_status: 200, expect_fields: ["success", "agent", "status"] },
    { tier: "fast", input: "Lifecycle: POST resume agent", type: "endpoint", method: "POST", path: "/agents/life-sciences-account-agent/resume", expect_status: 200, expect_fields: ["success", "agent", "status"] },
    { tier: "fast", input: "Lifecycle: DELETE test agent", type: "endpoint", method: "DELETE", path: "/agents/test-deletion-agent", expect_status: 200, expect_fields: ["success", "deleted"], pre_db_setup: { key: "test-deletion-agent", agent: { name: "test-deletion-agent", domain: "System", status: "Active", trigger_patterns: ["test"], purpose: "Temporary agent for deletion test" } } },
    { tier: "fast", input: "Lifecycle: GET version history", type: "endpoint", method: "GET", path: "/agents/life-sciences-account-agent/versions", expect_status: 200 },
  ],
};

export async function initTestSuite(agentName) {
  let suite = await getTestSuite(agentName);
  if (suite) return suite;

  const agentDefaults = DEFAULT_CASES[agentName] || [];
  const cases = agentDefaults.map(d => ({
    id: uuidv4(),
    tier: d.tier || "fast",
    input: d.input,
    type: d.type || "route",
    method: d.method || "POST",
    path: d.path || null,
    body: d.body || null,
    expect_status: d.expect_status || 200,
    expect_fields: d.expect_fields || null,
    expected_output_shape: { required_fields: d.expect_fields || ["agent", "output"] },
    pre_db_setup: d.pre_db_setup || null,
    last_run_at: null,
    last_status: null,
    last_output: null,
  }));

  // If no specific test cases defined, add a health check as fallback
  if (cases.length === 0) {
    cases.push({
      id: uuidv4(),
      input: `Health: ${agentName}`,
      type: "endpoint",
      method: "GET",
      path: `/agents/${agentName}/health`,
      expect_status: 200,
      expect_fields: ["status", "agent"],
      expected_output_shape: { required_fields: ["status", "agent"] },
      last_run_at: null,
      last_status: null,
      last_output: null,
    });
  }

  suite = {
    agent_name: agentName,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    baseline_captured_at: null,
    baseline_output: null,
    test_cases: cases,
  };

  await db.set(`test-suite:${agentName}`, suite);
  return suite;
}

export async function addTestCase(agentName, input, expectedShape) {
  let suite = await getTestSuite(agentName);
  if (!suite) suite = await initTestSuite(agentName);

  const tc = {
    id: uuidv4(),
    input,
    expected_output_shape: expectedShape || { required_fields: ["agent", "output"] },
    last_run_at: null,
    last_status: null,
    last_output: null,
  };

  suite.test_cases.push(tc);
  suite.updated_at = new Date().toISOString();
  await db.set(`test-suite:${agentName}`, suite);
  return tc;
}

export async function seedAllSuites() {
  const registry = await readRegistry();
  const agents = (registry.agents || []).filter(a => a.status === "Active" || a.status === "active");
  let seeded = 0;
  for (const agent of agents) {
    const existing = await getTestSuite(agent.name);
    if (!existing) {
      await initTestSuite(agent.name);
      seeded++;
    }
  }
  // Seed non-agent test suites (system-level test suites)
  for (const name of Object.keys(DEFAULT_CASES)) {
    if (!agents.some(a => a.name === name)) {
      const existing = await getTestSuite(name);
      if (!existing) {
        await initTestSuite(name);
        seeded++;
      }
    }
  }
  // Backfill type: "endpoint" and tier on any stored cases missing them
  const patched = await backfillTestSuites();
  if (patched > 0) console.log(`[TEST] Backfilled ${patched} test cases with type: "endpoint"`);
  return seeded;
}

// ── DB Backfill ─────────────────────────────────────────────────────────────

export async function backfillTestSuites() {
  const keys = await db.list("test-suite:");
  let patched = 0;
  for (const key of keys) {
    const suite = await db.get(key);
    if (!suite?.test_cases) continue;
    let dirty = false;
    for (const tc of suite.test_cases) {
      // Any case with a path should be type: "endpoint", not "route"
      if (tc.path && tc.type !== "endpoint") {
        tc.type = "endpoint";
        dirty = true;
        patched++;
      }
      // Backfill missing tier from STATIC defaults
      if (!tc.tier) {
        const defaults = DEFAULT_CASES[suite.agent_name] || [];
        const match = defaults.find(d => d.input === tc.input);
        tc.tier = match?.tier || "fast";
        dirty = true;
      }
    }
    if (dirty) {
      suite.updated_at = new Date().toISOString();
      await db.set(key, suite);
    }
  }
  return patched;
}

// ── Test Execution ──────────────────────────────────────────────────────────

async function callEndpoint(method, path, requestBody, timeoutMs = FULL_TIMEOUT_MS) {
  const start = Date.now();
  try {
    const opts = { method, signal: AbortSignal.timeout(timeoutMs) };
    if (method === "POST" || method === "PUT" || method === "DELETE") {
      opts.headers = { "Content-Type": "application/json" };
      if (requestBody) opts.body = JSON.stringify(requestBody);
      else if (method === "POST") opts.body = JSON.stringify({});
    }
    const resp = await fetch(`http://localhost:${PORT}${path}`, opts);
    const contentType = resp.headers.get("content-type") || "";
    let body = null;
    if (contentType.includes("json")) {
      body = await resp.json();
    }
    return { status: resp.status, body, duration_ms: Date.now() - start, error: null };
  } catch (e) {
    return { status: null, body: null, duration_ms: Date.now() - start, error: e.message };
  }
}

async function callAgentViaRoute(input) {
  // Import route dynamically to avoid circular dependency
  const { route } = await import("./master-agent.js");
  const start = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FULL_TIMEOUT_MS);

  try {
    const result = await route(input);
    clearTimeout(timeout);
    return { result, duration_ms: Date.now() - start, error: null };
  } catch (e) {
    clearTimeout(timeout);
    return { result: null, duration_ms: Date.now() - start, error: e.message };
  }
}

function classifyFailure(testCase, result, baseline, error, duration) {
  if (error && (error.includes("abort") || duration >= TEST_TIMEOUT_MS)) {
    return "timeout";
  }
  if (error) return "tool_failure";
  if (!result) return "routing_failure";

  const response = result.response || "";

  // Check if routed to correct agent
  const routeMatch = response.match(/Route to:\s*(.+)/);
  if (routeMatch) {
    const routed = routeMatch[1].trim();
    if (routed === "Claude-native" || routed.includes("BUILD BRIEF")) {
      // May be a routing failure if it should have gone to a spoke agent
    }
  }

  // Check output shape
  const shape = testCase.expected_output_shape;
  if (shape?.required_fields) {
    for (const field of shape.required_fields) {
      if (result[field] === undefined && result[field] !== null) {
        return "output_quality_failure";
      }
    }
  }

  // Check against baseline if exists
  if (baseline) {
    const baseLen = (baseline || "").length;
    const actualLen = response.length;
    if (baseLen > 0 && (actualLen < baseLen * 0.2 || actualLen > baseLen * 5)) {
      return "output_quality_failure";
    }
  }

  return null; // pass
}

export async function runTestCase(agentName, testCase, trigger, tier = "full") {
  // Safety guard: fast tier ONLY runs endpoint tests — never route through master agent
  if (tier === "fast" && testCase.type !== "endpoint") {
    return {
      id: uuidv4(),
      run_at: new Date().toISOString(),
      trigger: trigger || "manual",
      agent_name: agentName,
      test_case_id: testCase.id,
      status: "skip",
      failure_type: null,
      actual_output: null,
      baseline_output: null,
      confidence_score: null,
      duration_ms: 0,
      notes: "route tests excluded from fast tier",
    };
  }

  const suite = await getTestSuite(agentName);
  const baseline = suite?.baseline_output;

  let result, duration_ms, error, failureType;

  if (testCase.type === "endpoint" && testCase.path) {
    // Run setup if defined
    if (testCase.setup) {
      for (const step of testCase.setup) {
        await callEndpoint(step.method, step.path, step.body);
      }
    }
    // Direct DB setup (more reliable than HTTP setup for tests that modify registry)
    if (testCase.pre_db_setup?.agent) {
      const registry = await readRegistry();
      const exists = (registry.agents || []).some(a => a.name === testCase.pre_db_setup.agent.name);
      if (!exists) {
        registry.agents = registry.agents || [];
        registry.agents.push(testCase.pre_db_setup.agent);
        const { writeRegistry } = await import("../tools/registry-tools.js");
        await writeRegistry(registry);
      }
    }

    // Endpoint test — hit HTTP directly
    const timeoutMs = tier === "fast" ? FAST_TIMEOUT_MS : FULL_TIMEOUT_MS;
    const resp = await callEndpoint(testCase.method || "GET", testCase.path, testCase.body, timeoutMs);
    duration_ms = resp.duration_ms;
    error = resp.error;

    if (error) {
      failureType = error.includes("abort") ? "timeout" : "tool_failure";
    } else if (resp.status !== (testCase.expect_status || 200)) {
      failureType = "routing_failure";
      error = `Expected HTTP ${testCase.expect_status || 200}, got ${resp.status}`;
    } else if (testCase.expect_fields && resp.body) {
      for (const field of testCase.expect_fields) {
        if (resp.body[field] === undefined) {
          failureType = "output_quality_failure";
          error = `Missing field: ${field}`;
          break;
        }
      }
    }
    result = { response: JSON.stringify(resp.body)?.slice(0, 2000), confidence: null };
  } else {
    // Route test — go through master agent
    const routeResult = await callAgentViaRoute(testCase.input);
    result = routeResult.result;
    duration_ms = routeResult.duration_ms;
    error = routeResult.error;
    failureType = classifyFailure(testCase, result, baseline, error, duration_ms);
  }

  const run = {
    id: uuidv4(),
    run_at: new Date().toISOString(),
    trigger: trigger || "manual",
    agent_name: agentName,
    test_case_id: testCase.id,
    status: failureType ? "fail" : (error ? "error" : "pass"),
    failure_type: failureType || null,
    actual_output: result?.response?.slice(0, 2000) || null,
    baseline_output: baseline?.slice(0, 500) || null,
    confidence_score: result?.confidence || null,
    duration_ms,
    notes: error || null,
  };

  // Fast tier: skip DB writes entirely — no run history, no suite updates
  // Full tier: persist run records and update suite state
  if (tier === "full") {
    await db.set(`test-run:${run.id}`, run);

    try {
      const cached = await db.get(`agent-recent-runs:${run.agent_name}`) || [];
      cached.unshift(run);
      await db.set(`agent-recent-runs:${run.agent_name}`, cached.slice(0, 10));
    } catch (_) {}

    if (suite) {
      const tc = suite.test_cases.find(t => t.id === testCase.id);
      if (tc) {
        tc.last_run_at = run.run_at;
        tc.last_status = run.status;
        tc.last_output = run.actual_output?.slice(0, 500);
      }
      suite.updated_at = new Date().toISOString();

      // Capture baseline on first pass
      if (run.status === "pass" && !suite.baseline_output) {
        suite.baseline_output = run.actual_output;
        suite.baseline_captured_at = run.run_at;
      }

      await db.set(`test-suite:${agentName}`, suite);
    }
  }

  return run;
}

// ── Suite Runners ───────────────────────────────────────────────────────────

export async function runAgentTestSuite(agentName, trigger = "manual", tier = "fast") {
  let suite = await getTestSuite(agentName);
  if (!suite) suite = await initTestSuite(agentName);

  const cases = tier === "full"
    ? suite.test_cases
    : suite.test_cases.filter(tc => (tc.tier || "fast") === "fast");

  const results = [];
  for (const tc of cases) {
    const caseStart = Date.now();
    try {
      const run = await runTestCase(agentName, tc, trigger, tier);
      const elapsed = Date.now() - caseStart;
      if (elapsed > 1000) console.log(`[TEST-TIMING] SLOW case="${tc.input}" agent=${agentName} ${elapsed}ms`);
      results.push(run);
    } catch (e) {
      console.log(`[TEST-TIMING] ERROR case="${tc.input}" agent=${agentName} ${Date.now() - caseStart}ms: ${e.message}`);
      results.push({
        id: uuidv4(), run_at: new Date().toISOString(), trigger,
        agent_name: agentName, test_case_id: tc.id,
        status: "error", failure_type: "tool_failure",
        actual_output: null, confidence_score: null,
        duration_ms: 0, notes: e.message,
      });
    }
  }

  // Trend and dead-agent checks are expensive DB scans — skip in fast tier
  if (tier === "full") await checkTrends(agentName);
  return results;
}

export async function runFullTestSuite(trigger = "scheduled", tier = "fast") {
  console.log(`[TEST-TIMING] runFullTestSuite START tier=${tier} t=0ms`);
  const t0 = Date.now();

  const registry = await readRegistry();
  const agents = (registry.agents || []).filter(a =>
    (a.status === "Active" || a.status === "active") && !STATIC_AGENTS.has(a.name)
  );
  console.log(`[TEST-TIMING] registry read, ${agents.length} agents, t=${Date.now() - t0}ms`);

  const batchId = uuidv4();
  const batchStart = Date.now();
  const allResults = [];

  // Run tests for all registered agents
  for (const agent of agents) {
    const agentStart = Date.now();
    const results = await runAgentTestSuite(agent.name, trigger, tier);
    console.log(`[TEST-TIMING] agent=${agent.name} cases=${results.length} t=${Date.now() - agentStart}ms (total=${Date.now() - t0}ms)`);
    allResults.push(...results);
  }

  // Also run any non-agent test suites (e.g., agent-lifecycle)
  const allSuiteKeys = await db.list("test-suite:");
  console.log(`[TEST-TIMING] db.list returned ${allSuiteKeys.length} suite keys, t=${Date.now() - t0}ms`);
  const agentNames = new Set(agents.map(a => a.name));
  for (const key of allSuiteKeys) {
    const suiteName = key.replace("test-suite:", "");
    if (!agentNames.has(suiteName) && !STATIC_AGENTS.has(suiteName)) {
      const suite = await db.get(key);
      if (suite && suite.test_cases?.length > 0) {
        const suiteStart = Date.now();
        const results = await runAgentTestSuite(suiteName, trigger, tier);
        console.log(`[TEST-TIMING] suite=${suiteName} cases=${results.length} t=${Date.now() - suiteStart}ms (total=${Date.now() - t0}ms)`);
        allResults.push(...results);
      }
    }
  }

  const passed = allResults.filter(r => r.status === "pass").length;
  const failed = allResults.filter(r => r.status === "fail").length;
  const errors = allResults.filter(r => r.status === "error").length;
  const skipped = allResults.filter(r => r.status === "skip").length;

  // Dead-agent check scans all test-run keys per agent — skip in fast tier
  if (tier === "full") await checkDeadAgents();

  // Alert via Slack on failures — skip in fast tier (hits external webhook)
  if ((failed > 0 || errors > 0) && tier === "full") {
    try { await sendSystemAlert({ message: `Test run: ${failed} failed, ${errors} errors out of ${allResults.length} cases`, severity: "WARNING", source: "test-agent" }); }
    catch {}
  }

  console.log(`[TEST-TIMING] runFullTestSuite DONE total=${Date.now() - t0}ms passed=${passed} failed=${failed} errors=${errors} skipped=${skipped}`);

  return {
    run_batch_id: batchId,
    tier,
    agents_tested: new Set(allResults.map(r => r.agent_name)).size,
    total_cases: allResults.length,
    passed,
    failed,
    errors,
    skipped,
    duration_ms: Date.now() - batchStart,
    results: allResults,
  };
}

// ── Trend Tracking ──────────────────────────────────────────────────────────

async function checkTrends(agentName) {
  const keys = await db.list("test-run:");
  const runs = [];
  for (const key of keys) {
    const run = await db.get(key);
    if (run?.agent_name === agentName && run?.confidence_score !== null) {
      runs.push(run);
    }
  }

  runs.sort((a, b) => (b.run_at || "").localeCompare(a.run_at || ""));

  const now = new Date();
  const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString();
  const fourteenDaysAgo = new Date(now - 14 * 86400000).toISOString();

  const current = runs.filter(r => r.run_at >= sevenDaysAgo);
  const prior = runs.filter(r => r.run_at >= fourteenDaysAgo && r.run_at < sevenDaysAgo);

  if (current.length < 2 || prior.length < 2) return;

  const currentAvg = current.reduce((s, r) => s + r.confidence_score, 0) / current.length;
  const priorAvg = prior.reduce((s, r) => s + r.confidence_score, 0) / prior.length;

  if (priorAvg - currentAvg >= 10) {
    await db.set(`agent-warning:${agentName}`, {
      agent_name: agentName,
      flagged_at: new Date().toISOString(),
      reason: "confidence_drop",
      prior_avg: Math.round(priorAvg),
      current_avg: Math.round(currentAvg),
      recommended_action: `Investigate ${agentName} — confidence dropped ${Math.round(priorAvg - currentAvg)} points in 7 days`,
    });
  }
}

async function checkDeadAgents() {
  const registry = await readRegistry();
  const agents = (registry.agents || []).filter(a => a.status === "Active" && !STATIC_AGENTS.has(a.name));
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  for (const agent of agents) {
    // Find most recent test run
    const keys = await db.list("test-run:");
    let lastRun = null;
    for (const key of keys) {
      const run = await db.get(key);
      if (run?.agent_name === agent.name) {
        if (!lastRun || run.run_at > lastRun.run_at) lastRun = run;
      }
    }

    if (!lastRun || lastRun.run_at < thirtyDaysAgo) {
      await db.set(`agent-warning:${agent.name}`, {
        agent_name: agent.name,
        flagged_at: new Date().toISOString(),
        reason: "not_called_30_days",
        prior_avg: null,
        current_avg: null,
        recommended_action: `${agent.name} has not been called in 30+ days — consider deprecating or running a manual test`,
      });
    }
  }
}

// ── Baseline Management ─────────────────────────────────────────────────────

export async function approveBaseline(agentName) {
  const suite = await getTestSuite(agentName);
  if (!suite) throw new Error(`No test suite for ${agentName}`);

  // Find most recent passing run
  const keys = await db.list("test-run:");
  let latestPass = null;
  for (const key of keys) {
    const run = await db.get(key);
    if (run?.agent_name === agentName && run?.status === "pass") {
      if (!latestPass || run.run_at > latestPass.run_at) latestPass = run;
    }
  }

  if (!latestPass) throw new Error(`No passing run found for ${agentName}`);

  suite.baseline_output = latestPass.actual_output;
  suite.baseline_captured_at = new Date().toISOString();
  suite.updated_at = new Date().toISOString();
  await db.set(`test-suite:${agentName}`, suite);

  return { approved: true, baseline_from_run: latestPass.id };
}

// ── Warnings ────────────────────────────────────────────────────────────────

export async function getWarnings() {
  const keys = await db.list("agent-warning:");
  const warnings = [];
  for (const key of keys) {
    const w = await db.get(key);
    if (w) warnings.push(w);
  }
  return warnings.sort((a, b) => (b.flagged_at || "").localeCompare(a.flagged_at || ""));
}

export async function getRecentRuns(agentName, limit = 50) {
  const keys = await db.list("test-run:");
  const runs = [];
  for (const key of keys) {
    const run = await db.get(key);
    if (run && (!agentName || run.agent_name === agentName)) {
      runs.push(run);
    }
  }
  runs.sort((a, b) => (b.run_at || "").localeCompare(a.run_at || ""));
  return runs.slice(0, limit);
}

export async function getAllSuites() {
  const keys = await db.list("test-suite:");
  const suites = [];
  for (const key of keys) {
    const s = await db.get(key);
    if (s) suites.push(s);
  }
  return suites;
}
