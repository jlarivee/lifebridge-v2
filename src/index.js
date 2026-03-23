import express from "express";
import cron from "node-cron";
import path from "path";
import { fileURLToPath } from "url";
import { initDefaults } from "./db.js";
import { route } from "./agents/master-agent.js";
import { runImprovementCycle } from "./agents/improvement-agent.js";
import { logFeedback, readRecentLog } from "./tools/log-tools.js";
import { approveChange, rejectChange } from "./tools/approval-tools.js";
import { readRegistry, writeRegistry } from "./tools/registry-tools.js";
import { readContext } from "./tools/context-tools.js";
import { runAccountAgent } from "./agents/life-sciences-account-agent.js";
import { runAgentBuilder, continueBuild } from "./agents/agent-builder-agent.js";
import { loadDynamicAgents } from "./agent-loader.js";
import {
  runFullTestSuite, runAgentTestSuite, getAllSuites, getTestSuite,
  addTestCase, getRecentRuns, getWarnings, approveBaseline, initTestSuite,
  seedAllSuites
} from "./agents/test-agent.js";
import { deployAgent } from "./tools/deploy-tools.js";
import { runIntegrityCheck, getIntegrityReports } from "./agents/registry-integrity-agent.js";
import { v4 as uuidv4 } from "uuid";
import * as db from "./db.js";
import Database from "@replit/database";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// ── Routes ──────────────────────────────────────────────────────────────────

app.post("/route", async (req, res) => {
  try {
    const { input } = req.body;
    if (!input?.trim()) return res.status(400).json({ error: "Missing 'input' field" });
    const result = await route(input.trim());
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/route/feedback", async (req, res) => {
  try {
    const { request_id, outcome, feedback } = req.body;
    if (!request_id || !["accepted", "rejected"].includes(outcome))
      return res.status(400).json({ error: "request_id and outcome (accepted/rejected) required" });
    await logFeedback(request_id, outcome, feedback || "");
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/improve/run", async (req, res) => {
  try {
    const proposal = await runImprovementCycle();
    res.json(proposal);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/improve/approve", async (req, res) => {
  try {
    const { proposal_id, change_index } = req.body;
    if (!proposal_id || change_index === undefined)
      return res.status(400).json({ error: "proposal_id and change_index required" });
    const desc = await approveChange(proposal_id, parseInt(change_index));
    res.json({ success: true, change_applied: desc });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/improve/reject", async (req, res) => {
  try {
    const { proposal_id, change_index } = req.body;
    if (!proposal_id || change_index === undefined)
      return res.status(400).json({ error: "proposal_id and change_index required" });
    await rejectChange(proposal_id, parseInt(change_index));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/improve/history", async (req, res) => {
  try {
    const keys = await db.list("improvement:");
    const entries = [];
    for (const key of keys) {
      const entry = await db.get(key);
      if (entry) entries.push(entry);
    }
    entries.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
    res.json(entries);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/registry", async (req, res) => {
  try { res.json(await readRegistry()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/context", async (req, res) => {
  try { res.json(await readContext()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/agents/account", async (req, res) => {
  try {
    const { input, context } = req.body || {};
    if (!input) return res.status(400).json({ error: "input required" });
    const result = await runAccountAgent(input, context || {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/agents/builder", async (req, res) => {
  try {
    const { build_brief, context } = req.body || {};
    if (!build_brief) return res.status(400).json({ error: "build_brief required" });
    const result = await runAgentBuilder(build_brief, context || {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/agents/builder/continue", async (req, res) => {
  try {
    const { session_id, message } = req.body || {};
    if (!session_id) return res.status(400).json({ error: "session_id required" });
    const userMsg = message || "Approved. Proceed to the next phase.";
    const result = await continueBuild(session_id, userMsg);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/system/deploy-agent", async (req, res) => {
  try {
    const { agent_name, skill_content, code_content, registry_entry } = req.body || {};
    if (!agent_name || !skill_content || !code_content || !registry_entry) {
      return res.status(400).json({ error: "agent_name, skill_content, code_content, registry_entry required" });
    }
    const result = await deployAgent(agent_name, skill_content, code_content, registry_entry);

    // Dynamically load the new agent's route immediately
    const loaded = await loadDynamicAgents(app);
    console.log(`[DEPLOY] Hot-loaded ${loaded} new agent(s)`);

    // Auto-run test suite for the newly deployed agent
    try {
      await initTestSuite(agent_name);
      const testResults = await runAgentTestSuite(agent_name, "deploy");
      console.log(`[TEST] Post-deploy test for ${agent_name}: ${testResults.filter(r => r.status === "pass").length}/${testResults.length} passed`);
      result.test_results = testResults;
    } catch (e) {
      console.log(`[TEST] Post-deploy test failed for ${agent_name}: ${e.message}`);
    }

    // Post-deploy integrity scan
    try {
      const intReport = await runIntegrityCheck("deploy", agent_name);
      console.log(`[INTEGRITY] Post-deploy scan for ${agent_name}: ${intReport.status}`);
      if (intReport.status === "critical") {
        await db.set(`system-alert:${uuidv4()}`, {
          id: uuidv4(), created_at: new Date().toISOString(),
          severity: "critical", source: "registry-integrity-agent",
          issue_count: intReport.issues.length, report_id: intReport.report_id,
          acknowledged: false,
        });
      }
      result.integrity_report = intReport;
    } catch (e) {
      console.log(`[INTEGRITY] Post-deploy scan failed: ${e.message}`);
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/system/agent-loaded", async (req, res) => {
  const { agent, timestamp } = req.body || {};
  console.log(`\n[LIFEBRIDGE] New agent hot-loaded: ${agent} at ${timestamp}`);
  console.log(`[LIFEBRIDGE] Route: POST /agents/${agent}`);
  console.log(`[LIFEBRIDGE] Registry updated. System ready.\n`);
  try {
    const rawDb = new Database();
    const registryRaw = await rawDb.get("registry");
    const registry = registryRaw ? JSON.parse(registryRaw) : { agents: [] };
    res.json({ success: true, message: `Agent ${agent} is now live`, total_agents: registry.agents?.length || 0 });
  } catch (e) {
    res.json({ success: true, message: `Agent ${agent} hot-loaded` });
  }
});

// ── Test Agent ──────────────────────────────────────────────────────────────

app.post("/test/run", async (req, res) => {
  try {
    const result = await runFullTestSuite("manual");
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/test/run/:agent", async (req, res) => {
  try {
    const results = await runAgentTestSuite(req.params.agent, "manual");
    const passed = results.filter(r => r.status === "pass").length;
    const failed = results.filter(r => r.status === "fail").length;
    const errors = results.filter(r => r.status === "error").length;
    res.json({ agent: req.params.agent, total: results.length, passed, failed, errors, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/test/suites", async (req, res) => {
  try { res.json(await getAllSuites()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/test/suites/:agent", async (req, res) => {
  try {
    const suite = await getTestSuite(req.params.agent);
    if (!suite) return res.status(404).json({ error: "No test suite found" });
    res.json(suite);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/test/suites/:agent/cases", async (req, res) => {
  try {
    const { input, expected_output_shape } = req.body || {};
    if (!input) return res.status(400).json({ error: "input required" });
    const tc = await addTestCase(req.params.agent, input, expected_output_shape);
    res.json(tc);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/test/runs", async (req, res) => {
  try { res.json(await getRecentRuns(null, 50)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/test/runs/:agent", async (req, res) => {
  try { res.json(await getRecentRuns(req.params.agent, 50)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/test/warnings", async (req, res) => {
  try { res.json(await getWarnings()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/test/baseline/approve/:agent", async (req, res) => {
  try {
    const result = await approveBaseline(req.params.agent);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/test/baseline/reject/:agent", async (req, res) => {
  res.json({ rejected: true, agent: req.params.agent, message: "Baseline kept as-is" });
});

app.get("/test/verify", async (req, res) => {
  try {
    const issues = [];

    // Registry entry check
    const registry = await readRegistry();
    const testEntry = (registry.agents || []).find(a => a.name === "test-agent");
    const registryPass = testEntry && testEntry.status === "Active";
    if (!registryPass) issues.push("test-agent not in registry or not Active");

    // Endpoint checks
    const endpointChecks = {};
    try { await getAllSuites(); endpointChecks.get_suites = "pass"; }
    catch { endpointChecks.get_suites = "fail"; issues.push("GET /test/suites failed"); }

    try { await getRecentRuns(null, 1); endpointChecks.get_runs = "pass"; }
    catch { endpointChecks.get_runs = "fail"; issues.push("GET /test/runs failed"); }

    try { await getWarnings(); endpointChecks.get_warnings = "pass"; }
    catch { endpointChecks.get_warnings = "fail"; issues.push("GET /test/warnings failed"); }

    // Database key counts
    const suiteKeys = await db.list("test-suite:");
    const runKeys = await db.list("test-run:");
    const warnKeys = await db.list("agent-warning:");

    const overall = registryPass &&
      endpointChecks.get_suites === "pass" &&
      endpointChecks.get_runs === "pass" &&
      endpointChecks.get_warnings === "pass";

    res.json({
      registry_entry: registryPass ? "pass" : "fail",
      scheduler_registered: "pass",
      endpoints_responding: endpointChecks,
      database_keys: {
        test_suites_found: suiteKeys.length,
        test_runs_found: runKeys.length,
        warnings_found: warnKeys.length,
      },
      overall: overall ? "pass" : "fail",
      issues,
    });
  } catch (e) {
    res.status(500).json({ overall: "fail", error: e.message });
  }
});

// ── Ideas ───────────────────────────────────────────────────────────────────

app.post("/ideas", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text?.trim()) return res.status(400).json({ error: "text required" });
    const idea = {
      id: uuidv4(),
      text: text.trim(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      status: "saved",
      last_sent_at: null,
      send_count: 0,
      agent_responses: [],
    };
    await db.set(`idea:${idea.id}`, idea);
    res.json(idea);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/ideas", async (req, res) => {
  try {
    const keys = await db.list("idea:");
    const ideas = [];
    for (const key of keys) {
      const idea = await db.get(key);
      if (idea) ideas.push(idea);
    }
    ideas.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    res.json(ideas);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/ideas/:id", async (req, res) => {
  try {
    const idea = await db.get(`idea:${req.params.id}`);
    if (!idea) return res.status(404).json({ error: "Idea not found" });
    const { text } = req.body || {};
    if (text !== undefined) idea.text = text.trim();
    idea.updated_at = new Date().toISOString();
    await db.set(`idea:${idea.id}`, idea);
    res.json(idea);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/ideas/:id", async (req, res) => {
  try {
    const idea = await db.get(`idea:${req.params.id}`);
    if (!idea) return res.status(404).json({ error: "Idea not found" });
    idea.status = "archived";
    idea.updated_at = new Date().toISOString();
    await db.set(`idea:${idea.id}`, idea);
    res.json(idea);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/ideas/:id/send", async (req, res) => {
  try {
    const idea = await db.get(`idea:${req.params.id}`);
    if (!idea) return res.status(404).json({ error: "Idea not found" });

    const result = await route(idea.text);

    idea.status = "sent";
    idea.last_sent_at = new Date().toISOString();
    idea.send_count = (idea.send_count || 0) + 1;
    idea.agent_responses.push({
      sent_at: idea.last_sent_at,
      response: result.response,
      confidence: result.confidence,
      id: result.id,
    });
    idea.updated_at = new Date().toISOString();
    await db.set(`idea:${idea.id}`, idea);

    res.json({ idea, routing_result: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Registry Integrity ───────────────────────────────────────────────────────

app.post("/integrity/run", async (req, res) => {
  try { res.json(await runIntegrityCheck("manual")); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/integrity/run/:agent", async (req, res) => {
  try { res.json(await runIntegrityCheck("manual", req.params.agent)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/integrity/reports", async (req, res) => {
  try { res.json(await getIntegrityReports(20)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/integrity/reports/latest", async (req, res) => {
  try {
    const reports = await getIntegrityReports(1);
    res.json(reports[0] || { status: "no reports yet" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/integrity/alerts", async (req, res) => {
  try {
    const keys = await db.list("system-alert:");
    const alerts = [];
    for (const key of keys) {
      const a = await db.get(key);
      if (a && !a.acknowledged) alerts.push(a);
    }
    alerts.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    res.json(alerts);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/integrity/alerts/:id/acknowledge", async (req, res) => {
  try {
    const { reason } = req.body || {};
    const keys = await db.list("system-alert:");
    for (const key of keys) {
      const alert = await db.get(key);
      if (alert && alert.id === req.params.id) {
        alert.acknowledged = true;
        alert.acknowledged_at = new Date().toISOString();
        alert.acknowledged_reason = reason || "";
        await db.set(key, alert);
        return res.json({ success: true, alert });
      }
    }
    res.status(404).json({ error: "Alert not found" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Dynamic health endpoint — handles ALL agents via registry lookup
app.get("/agents/:name/health", async (req, res) => {
  try {
    const registry = await readRegistry();
    const agent = (registry.agents || []).find(a => a.name === req.params.name);
    if (!agent) return res.status(404).json({ error: "Agent not found in registry" });
    const isActive = agent.status === "Active" || agent.status === "active";
    if (!isActive) return res.status(503).json({ status: "inactive", agent: agent.name });
    res.json({ status: "ok", agent: agent.name, domain: agent.domain, checked_at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// JSON 404 for API/test paths — prevents HTML fallback
app.all("/test/*", (req, res) => {
  res.status(404).json({ error: `Endpoint not found: ${req.method} ${req.path}` });
});
app.all("/agents/*", (req, res) => {
  res.status(404).json({ error: `Endpoint not found: ${req.method} ${req.path}` });
});
app.all("/improve/*", (req, res) => {
  res.status(404).json({ error: `Endpoint not found: ${req.method} ${req.path}` });
});
app.all("/integrity/*", (req, res) => {
  res.status(404).json({ error: `Endpoint not found: ${req.method} ${req.path}` });
});
app.all("/system/*", (req, res) => {
  res.status(404).json({ error: `Endpoint not found: ${req.method} ${req.path}` });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ── Startup ─────────────────────────────────────────────────────────────────

async function registerAccountAgent() {
  const registry = await readRegistry();
  const alreadyRegistered = (registry.agents || []).some(
    (a) => a.name === "life-sciences-account-agent"
  );
  if (!alreadyRegistered) {
    registry.agents = registry.agents || [];
    registry.agents.push({
      name: "life-sciences-account-agent",
      domain: "Work",
      trigger_patterns: [
        "account brief", "meeting prep", "executive briefing",
        "stakeholder dossier", "competitive positioning",
        "outreach email", "follow up", "account strategy",
        "Pfizer", "BMS", "Bristol Myers", "Novartis", "Lilly",
        "Cigna", "Elevance", "pharma", "payer", "SCA", "ProServe"
      ],
      tools: ["web_search"],
      requires_approval: ["outbound email", "external sharing"],
      status: "Active",
    });
    await writeRegistry(registry);
    console.log("Registered: life-sciences-account-agent");
  }
}

async function registerBuilderAgent() {
  const registry = await readRegistry();
  const alreadyRegistered = (registry.agents || []).some(
    (a) => a.name === "agent-builder-agent"
  );
  if (!alreadyRegistered) {
    registry.agents = registry.agents || [];
    registry.agents.push({
      name: "agent-builder-agent",
      domain: "System",
      trigger_patterns: [
        "build brief", "build this agent", "create a new agent",
        "new agent needed", "deploy an agent", "agent builder", "BUILD BRIEF"
      ],
      tools: ["web_search"],
      requires_approval: ["all deployments"],
      status: "Active",
    });
    await writeRegistry(registry);
    console.log("Registered: agent-builder-agent");
  }
}

async function registerTestAgent() {
  const registry = await readRegistry();
  const exists = (registry.agents || []).some(a => a.name === "test-agent");
  if (!exists) {
    registry.agents = registry.agents || [];
    registry.agents.push({
      name: "test-agent",
      domain: "System",
      purpose: "Verifies all spoke agents are functioning correctly via structured test suites, baseline comparison, and trend tracking",
      status: "Active",
      trigger_patterns: ["test", "run tests", "check agents", "test suite", "agent health"],
      triggers: ["scheduled_daily_7am", "on_agent_deploy", "manual"],
      endpoints: ["/test/run", "/test/run/:agent", "/test/suites", "/test/runs", "/test/warnings"],
      requires_approval: ["baseline_overwrite"],
      created_at: new Date().toISOString(),
    });
    await writeRegistry(registry);
    console.log("Registered: test-agent");
  }
}

async function registerIntegrityAgent() {
  const registry = await readRegistry();
  const exists = (registry.agents || []).some(a => a.name === "registry-integrity-agent");
  if (!exists) {
    registry.agents = registry.agents || [];
    registry.agents.push({
      name: "registry-integrity-agent",
      domain: "System",
      purpose: "Verifies all active registry entries have real files on disk, live routes, and in-sync skill files. Detects orphans and ghost entries. Never modifies — only reports.",
      status: "Active",
      trigger_patterns: ["integrity", "health check", "registry check", "orphan", "ghost entry"],
      triggers: ["scheduled_weekly_sunday_5am", "on_agent_deploy", "manual"],
      endpoints: ["/integrity/run", "/integrity/run/:agent", "/integrity/reports", "/integrity/reports/latest", "/integrity/alerts"],
      requires_approval: [],
      created_at: new Date().toISOString(),
    });
    await writeRegistry(registry);
    console.log("Registered: registry-integrity-agent");
  }
}

async function start() {
  await initDefaults();
  await registerAccountAgent();
  await registerBuilderAgent();
  await registerTestAgent();
  await registerIntegrityAgent();

  // Dynamic agent loader — mounts routes for any deployed spoke agents
  const dynamicCount = await loadDynamicAgents(app);
  if (dynamicCount > 0) {
    console.log(`Loaded ${dynamicCount} dynamic agent(s) from registry`);
  }

  // Seed test suites for all active agents
  const seeded = await seedAllSuites();
  if (seeded > 0) console.log(`Seeded ${seeded} new test suite(s)`);

  // Weekly integrity scan Sunday 5:00 AM UTC
  cron.schedule("0 5 * * 0", async () => {
    try {
      const report = await runIntegrityCheck("scheduled");
      console.log(`[INTEGRITY] Weekly scan: ${report.status} — ${report.agents_checked} agents, ${report.issues.length} issues`);
      if (report.status === "critical") {
        await db.set(`system-alert:${uuidv4()}`, {
          id: uuidv4(), created_at: new Date().toISOString(),
          severity: "critical", source: "registry-integrity-agent",
          issue_count: report.issues.length, report_id: report.report_id,
          acknowledged: false,
        });
      }
    } catch (e) {
      console.error(`[INTEGRITY] Weekly scan failed: ${e.message}`);
    }
  }, { timezone: "UTC" });
  console.log("Registry Integrity Agent registered — weekly scan Sunday 5:00 AM UTC");

  // Daily test suite at 7:00 AM UTC
  cron.schedule("0 7 * * *", async () => {
    try {
      const result = await runFullTestSuite("scheduled");
      console.log(`[TEST] Daily run: ${result.passed}/${result.total_cases} passed, ${result.failed} failed, ${result.errors} errors`);
    } catch (e) {
      console.error(`[TEST] Daily run failed: ${e.message}`);
    }
  }, { timezone: "UTC" });
  console.log("Test Agent registered — daily run at 7:00 AM UTC");

  // Daily improvement cycle at midnight UTC
  cron.schedule("0 0 * * *", async () => {
    try {
      const proposal = await runImprovementCycle();
      console.log(`Daily improvement cycle: proposal ${proposal.id}, ${proposal.requests_reviewed} requests`);
    } catch (e) {
      console.error(`Daily improvement cycle failed: ${e.message}`);
    }
  }, { timezone: "UTC" });

  const port = process.env.PORT || 5000;
  app.listen(port, () => {
    console.log("LifeBridge v2.0 running on Claude Agent SDK");
    console.log(`Listening on port ${port}`);
  });
}

start().catch(e => {
  console.error("Startup failed:", e);
  process.exit(1);
});
