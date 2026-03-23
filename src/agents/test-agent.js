/**
 * LifeBridge Test Agent
 * Verifies spoke agents via structured test suites, baseline comparison,
 * and trend tracking. Runs daily, on deploy, and on demand.
 */

import { v4 as uuidv4 } from "uuid";
import * as db from "../db.js";
import { readRegistry } from "../tools/registry-tools.js";

const STATIC_AGENTS = new Set(["test-agent"]);
const TEST_TIMEOUT_MS = 30000;
const PORT = process.env.PORT || 5000;

// ── Test Suite Management ───────────────────────────────────────────────────

export async function getTestSuite(agentName) {
  return await db.get(`test-suite:${agentName}`);
}

// Default test cases per agent type — all endpoint-based, no natural language routing
const DEFAULT_CASES = {
  "life-sciences-account-agent": [
    { input: "Health: life-sciences-account-agent", type: "endpoint", method: "GET", path: "/agents/life-sciences-account-agent/health", expect_status: 200, expect_fields: ["status", "agent"] },
  ],
  "agent-builder-agent": [
    { input: "Health: agent-builder-agent", type: "endpoint", method: "GET", path: "/agents/agent-builder-agent/health", expect_status: 200, expect_fields: ["status", "agent"] },
  ],
  "slab-inventory-tracker-agent": [
    { input: "Health: slab-inventory-tracker-agent", type: "endpoint", method: "GET", path: "/agents/slab-inventory-tracker-agent/health", expect_status: 200, expect_fields: ["status", "agent"] },
  ],
  "registry-integrity-agent": [
    { input: "GET /integrity/reports/latest", type: "endpoint", method: "GET", path: "/integrity/reports/latest", expect_status: 200 },
    { input: "POST /integrity/run", type: "endpoint", method: "POST", path: "/integrity/run", expect_status: 200, expect_fields: ["report_id", "status", "agents_checked"] },
  ],
  "test-agent": [
    { input: "GET /test/suites", type: "endpoint", method: "GET", path: "/test/suites", expect_status: 200 },
    { input: "GET /test/warnings", type: "endpoint", method: "GET", path: "/test/warnings", expect_status: 200 },
    { input: "GET /test/verify", type: "endpoint", method: "GET", path: "/test/verify", expect_status: 200, expect_fields: ["overall"] },
  ],
  "intelligence-update-agent": [
    { input: "GET /intelligence/status", type: "endpoint", method: "GET", path: "/intelligence/status", expect_status: 200, expect_fields: ["status", "agent"] },
    { input: "GET /intelligence/findings", type: "endpoint", method: "GET", path: "/intelligence/findings", expect_status: 200 },
    { input: "GET /intelligence/sources", type: "endpoint", method: "GET", path: "/intelligence/sources", expect_status: 200 },
  ],
};

export async function initTestSuite(agentName) {
  let suite = await getTestSuite(agentName);
  if (suite) return suite;

  const agentDefaults = DEFAULT_CASES[agentName] || [];
  const cases = agentDefaults.map(d => ({
    id: uuidv4(),
    input: d.input,
    type: d.type || "route",
    method: d.method || "POST",
    path: d.path || null,
    expect_status: d.expect_status || 200,
    expect_fields: d.expect_fields || null,
    expected_output_shape: { required_fields: d.expect_fields || ["agent", "output"] },
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
  return seeded;
}

// ── Test Execution ──────────────────────────────────────────────────────────

async function callEndpoint(method, path) {
  const start = Date.now();
  try {
    const opts = { method, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) };
    if (method === "POST") {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify({});
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
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

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

export async function runTestCase(agentName, testCase, trigger) {
  const suite = await getTestSuite(agentName);
  const baseline = suite?.baseline_output;

  let result, duration_ms, error, failureType;

  if (testCase.type === "endpoint" && testCase.path) {
    // Endpoint test — hit HTTP directly
    const resp = await callEndpoint(testCase.method || "GET", testCase.path);
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

  await db.set(`test-run:${run.id}`, run);

  // Update test case in suite
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

  return run;
}

// ── Suite Runners ───────────────────────────────────────────────────────────

export async function runAgentTestSuite(agentName, trigger = "manual") {
  let suite = await getTestSuite(agentName);
  if (!suite) suite = await initTestSuite(agentName);

  const results = [];
  for (const tc of suite.test_cases) {
    try {
      const run = await runTestCase(agentName, tc, trigger);
      results.push(run);
    } catch (e) {
      results.push({
        id: uuidv4(), run_at: new Date().toISOString(), trigger,
        agent_name: agentName, test_case_id: tc.id,
        status: "error", failure_type: "tool_failure",
        actual_output: null, confidence_score: null,
        duration_ms: 0, notes: e.message,
      });
    }
  }

  await checkTrends(agentName);
  return results;
}

export async function runFullTestSuite(trigger = "scheduled") {
  const registry = await readRegistry();
  const agents = (registry.agents || []).filter(a =>
    a.status === "Active" && !STATIC_AGENTS.has(a.name)
  );

  const batchId = uuidv4();
  const batchStart = Date.now();
  const allResults = [];

  for (const agent of agents) {
    const results = await runAgentTestSuite(agent.name, trigger);
    allResults.push(...results);
  }

  const passed = allResults.filter(r => r.status === "pass").length;
  const failed = allResults.filter(r => r.status === "fail").length;
  const errors = allResults.filter(r => r.status === "error").length;

  await checkDeadAgents();

  return {
    run_batch_id: batchId,
    agents_tested: agents.length,
    total_cases: allResults.length,
    passed,
    failed,
    errors,
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
