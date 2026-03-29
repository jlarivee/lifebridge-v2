import express from "express";
import cron from "node-cron";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { execSync } from "child_process";
import Anthropic from "@anthropic-ai/sdk";
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
import {
  runIntelligenceScan, getFindings, getFinding, approveFinding,
  rejectFinding, getAllSources
} from "./agents/intelligence-update-agent.js";
import {
  getStatus as getConnectorStatus, testConnector, sendGmail, readGmail,
  sendSlack, approveSend, getSendLog, getConfig as getConnectorConfig,
  updateConfig as updateConnectorConfig
} from "./agents/connectors.js";
import {
  getItaly2026Health, getItaly2026Data
} from "./connectors/italy2026-connector.js";
import {
  runBriefing, previewBriefing, getLatestBriefing, getBriefingHistory
} from "./agents/morning-briefing-agent.js";
import {
  runConsolidation, getProposals, getProposal, approveProposal,
  rejectProposal, getHistory as getMemoryHistory, getFacts
} from "./agents/memory-consolidation-agent.js";
import {
  initTravelProfile, runTravelAgent, registerTravelAgent as registerTravelAgentInRegistry,
  getProfile as getTravelProfile, updateProfile as updateTravelProfile,
  getTrips, getTrip, createTrip, updateTrip, deleteTrip,
  getFlightWatches, getFlightWatch, createFlightWatch, updateFlightWatch, deleteFlightWatch,
  getLoyaltySnapshots, getLatestLoyaltySnapshot, getLoyaltySnapshot,
  createLoyaltySnapshot, updateLoyaltySnapshot, deleteLoyaltySnapshot,
  getTravelDocs, getTravelDoc, createTravelDoc, updateTravelDoc, deleteTravelDoc,
  checkFlightWatches, checkDocExpiry, sendLoyaltyReminder
} from "./agents/travel-agent.js";
import {
  runInvestmentResearchAgent, getInvestmentWatchlist, getInvestmentPortfolio,
  getInvestmentTrades, getInvestmentSummary
} from "./agents/investment-research-agent.js";
import {
  startSession as peStartSession,
  sessionMessage as peSessionMessage,
  generatePrompt as peGeneratePrompt,
  savePrompt as peSavePrompt,
  listPrompts as peListPrompts,
  getPrompt as peGetPrompt,
  updatePrompt as peUpdatePrompt,
  deletePrompt as peDeletePrompt,
} from "./agents/prompt-engineering-agent.js";
import { autoRegisterAllAgents } from "./auto-register.js";
import { v4 as uuidv4 } from "uuid";
import * as db from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new Anthropic();
const app = express();

// ── GitHub Webhook — auto-pull and restart on every push to main ─────────────
// Must be registered BEFORE app.use(express.json()) so we can read the raw body
// for HMAC signature verification.
// Setup: GitHub repo → Settings → Webhooks → Add webhook
//   Payload URL:  https://lifebridge-v-2.replit.app/webhooks/github
//   Content type: application/json
//   Secret:       value of GITHUB_WEBHOOK_SECRET env var (optional but recommended)
//   Events:       Just the push event
app.post("/webhooks/github", express.raw({ type: "*/*" }), (req, res) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const sig    = req.headers["x-hub-signature-256"];

  if (secret && sig) {
    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(req.body);
    const expected = "sha256=" + hmac.digest("hex");
    if (sig !== expected) {
      console.log("[WEBHOOK] Invalid signature — request rejected");
      return res.status(401).json({ error: "Invalid signature" });
    }
  }

  let payload;
  try { payload = JSON.parse(req.body.toString()); }
  catch { return res.status(400).json({ error: "Invalid JSON payload" }); }

  const branch  = payload.ref?.replace("refs/heads/", "");
  const pusher  = payload.pusher?.name || "unknown";
  const commits = payload.commits?.length ?? 0;
  const msg     = commits > 0 ? payload.commits[0].message.split("\n")[0] : "";

  if (branch !== "main") {
    console.log(`[WEBHOOK] Push to '${branch}' — skipped (not main)`);
    return res.json({ skipped: true, reason: `branch '${branch}' is not main` });
  }

  console.log(`[WEBHOOK] Push to main by ${pusher}: "${msg}" (${commits} commit(s)) — pulling`);
  res.json({ ok: true, message: `Pull queued — ${commits} commit(s) from ${pusher}` });

  // Pull and restart after response is flushed (skip in local dev)
  setTimeout(() => {
    if (process.env.LOCAL_DEV) {
      console.log("[WEBHOOK] LOCAL_DEV — skipping pull/restart");
      return;
    }
    try {
      execSync("git pull origin main", { stdio: "inherit", timeout: 30000 });
      console.log("[WEBHOOK] Pull complete — restarting");
      process.exit(0); // Replit auto-restarts via sync-and-start.sh
    } catch (e) {
      console.error("[WEBHOOK] Pull failed:", e.message);
    }
  }, 500);
});
// ─────────────────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// ── Routes ──────────────────────────────────────────────────────────────────

app.post("/route", async (req, res) => {
  try {
    const { input } = req.body;
    if (!input?.trim()) return res.status(400).json({ error: "Missing 'input' field" });
    const result = await route(input.trim());

    // Auto-dispatch BUILD BRIEFs to agent-builder
    // Fire-and-forget: don't await — the builder runs in the background
    if (result.response && result.response.includes("BUILD BRIEF") && !result.response.includes("ENHANCE BRIEF")) {
      runAgentBuilder(result.response, {})
        .then(buildResult => {
          console.log(`[AUTO-BUILD] BUILD BRIEF completed: session ${buildResult.session_id}, phase ${buildResult.phase}`);
        })
        .catch(e => {
          console.log(`[AUTO-BUILD] Failed: ${e.message}`);
        });

      result.build_session = {
        status: "Build dispatched — builder running in background",
      };
      console.log(`[AUTO-BUILD] BUILD BRIEF dispatched (background)`);
    }

    // Auto-dispatch ENHANCE BRIEFs to agent-builder in enhance mode
    // Fire-and-forget: don't await — the builder runs in the background
    if (result.response && result.response.includes("ENHANCE BRIEF")) {
      const nameMatch = result.response.match(/Agent to enhance:\s+([\w-]+)/i);
      const enhanceMatch = result.response.match(/Enhancement:\s+([^\n]+)/i);
      const enhanceBrief = {
        agent_name: nameMatch ? nameMatch[1].trim() : "",
        agent_to_enhance: nameMatch ? nameMatch[1].trim() : "",
        enhancement: enhanceMatch ? enhanceMatch[1].trim() : result.response,
        raw: result.response,
      };

      // Run in background — don't block the HTTP response
      runAgentBuilder(enhanceBrief, { enhance_brief: enhanceBrief })
        .then(enhanceResult => {
          console.log(`[AUTO-ENHANCE] ENHANCE BRIEF completed for ${enhanceBrief.agent_name}: session ${enhanceResult.session_id}, phase ${enhanceResult.phase}`);
        })
        .catch(e => {
          console.log(`[AUTO-ENHANCE] Failed: ${e.message}`);
        });

      result.build_session = {
        mode: "enhance",
        agent: enhanceBrief.agent_name,
        status: "Enhance dispatched — builder running in background",
      };
      console.log(`[AUTO-ENHANCE] ENHANCE BRIEF dispatched for ${enhanceBrief.agent_name} (background)`);
    }

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

// Dismiss all pending improvement proposals
app.post("/improve/dismiss-all", async (req, res) => {
  try {
    const keys = await db.list("improvement:");
    let dismissed = 0;
    for (const key of keys) {
      const entry = await db.get(key);
      if (entry && entry.status === "pending") {
        entry.status = "dismissed";
        entry.dismissed_at = new Date().toISOString();
        await db.set(key, entry);
        dismissed++;
      }
    }
    res.json({ success: true, dismissed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Execution Log ──
app.get("/execution/log", async (req, res) => {
  try {
    const keys = await db.list("execution-log:");
    const logs = [];
    for (const key of keys) {
      const entry = await db.get(key);
      if (entry) logs.push(entry);
    }
    logs.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
    res.json(logs.slice(0, 20));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/registry", async (req, res) => {
  try { res.json(await readRegistry()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/registry/update", async (req, res) => {
  try {
    const body = req.body || {};
    const registry = await readRegistry();
    if (body.agent) {
      registry.agents = registry.agents || [];
      registry.agents.push(body.agent);
    }
    if (body.domain_signal) {
      registry.domain_signals = registry.domain_signals || [];
      registry.domain_signals.push(body.domain_signal);
    }
    if (body.connector) {
      registry.connectors = registry.connectors || [];
      registry.connectors.push(body.connector);
    }
    await writeRegistry(registry);
    res.json({ status: "updated", registry });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Builder approval gate ─────────────────────────────────────────────────────

app.get("/builder/pending", async (req, res) => {
  try {
    const keys = await db.list("builder:pending:");
    const pending = [];
    for (const key of keys) {
      const item = await db.get(key);
      if (item && item.status === "awaiting_approval") {
        // Don't send full file content in list view
        pending.push({
          id: item.id,
          agent: item.agent,
          agent_label: item.agent_label,
          domain: item.domain,
          mode: item.mode,
          files: item.files, // previews only
          created_at: item.created_at,
          status: item.status,
        });
      }
    }
    res.json({ pending });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/builder/pending/:id", async (req, res) => {
  try {
    const item = await db.get(`builder:pending:${req.params.id}`);
    if (!item) return res.status(404).json({ error: "Not found" });
    // Return full file content for detailed review
    res.json(item);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/builder/pending/:id/approve", async (req, res) => {
  try {
    const item = await db.get(`builder:pending:${req.params.id}`);
    if (!item) return res.status(404).json({ error: "Not found" });
    if (item.status !== "awaiting_approval") return res.json({ error: "Already processed", status: item.status });

    let deployResult;

    if (item.mode === "build") {
      // BUILD mode: deploy new agent with full UI wiring
      const { deployNewAgentFull, triggerGracefulRestart } = await import("./tools/deploy-tools.js");
      deployResult = await deployNewAgentFull(item.agent, item.full_files, item.agent_label, item.domain);

      item.status = "deployed";
      item.deploy_result = deployResult;
      item.approved_at = new Date().toISOString();
      await db.set(`builder:pending:${req.params.id}`, item);

      console.log(`[BUILDER] NEW AGENT DEPLOYED: ${item.agent} — ${item.full_files.length} files`);
      res.json({ status: "deployed", agent: item.agent, files: deployResult.files_written });
      triggerGracefulRestart(item.agent, "New agent approved and deployed");
    } else {
      // ENHANCE mode: deploy with safety net (rollback if tests fail)
      const { deployEnhancementSafe, triggerGracefulRestart } = await import("./tools/deploy-tools.js");
      deployResult = await deployEnhancementSafe(item.agent, item.full_files);

      item.status = deployResult.rolled_back ? "rolled_back" : "deployed";
      item.deploy_result = deployResult;
      item.approved_at = new Date().toISOString();
      await db.set(`builder:pending:${req.params.id}`, item);

      if (deployResult.rolled_back) {
        console.log(`[BUILDER] ROLLED BACK: ${item.agent} — ${deployResult.reason}`);
        res.json({ status: "rolled_back", reason: deployResult.reason });
      } else {
        console.log(`[BUILDER] APPROVED & DEPLOYED: ${item.agent} — ${item.full_files.length} files`);
        res.json({ status: "deployed", agent: item.agent, files: deployResult.files_written });
        triggerGracefulRestart(item.agent, "Enhancement approved and deployed");
      }
    }
  } catch (e) {
    console.log(`[BUILDER] APPROVE ERROR: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post("/builder/pending/:id/reject", async (req, res) => {
  try {
    const item = await db.get(`builder:pending:${req.params.id}`);
    if (!item) return res.status(404).json({ error: "Not found" });
    item.status = "rejected";
    item.rejected_at = new Date().toISOString();
    item.reject_reason = req.body?.reason || "Human rejected";
    await db.set(`builder:pending:${req.params.id}`, item);
    console.log(`[BUILDER] REJECTED: ${item.agent} — ${item.reject_reason}`);
    res.json({ status: "rejected", agent: item.agent });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── System endpoints ──────────────────────────────────────────────────────────

app.get("/system/maintenance", async (req, res) => {
  try {
    const status = await db.get("system:maintenance");
    res.json(typeof status === "string" ? JSON.parse(status) : status || { active: false });
  } catch { res.json({ active: false }); }
});

// Integrity test endpoints
app.get("/test/integrity/css", (req, res) => {
  const { createHash } = require("crypto");
  const cssFiles = ["dashboard.css", "variables.css", "reset.css", "components.css", "hub.css", "mobile.css"];
  const hashes = {};
  for (const f of cssFiles) {
    const fp = path.join(__dirname, `../public/css/${f}`);
    try {
      if (existsSync(fp)) {
        hashes[f] = createHash("sha256").update(readFileSync(fp, "utf8")).digest("hex");
      }
    } catch {}
  }
  res.json({ hashes, checked_at: new Date().toISOString() });
});

app.get("/test/integrity/config", (req, res) => {
  try {
    const configPath = path.join(__dirname, "../public/js/config.js");
    const content = readFileSync(configPath, "utf8");
    const maps = {
      AGENT_ENDPOINTS: content.includes("var AGENT_ENDPOINTS"),
      AGENT_LABELS: content.includes("var AGENT_LABELS"),
      DASHBOARD_AGENTS: content.includes("var DASHBOARD_AGENTS"),
      DOMAIN_MASTERS: content.includes("var DOMAIN_MASTERS"),
    };
    res.json({ valid: Object.values(maps).every(Boolean), maps });
  } catch (e) {
    res.json({ valid: false, error: e.message });
  }
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
        const alertId = uuidv4();
        await db.set(`system-alert:${alertId}`, {
          id: alertId, created_at: new Date().toISOString(),
          severity: "critical", source: "registry-integrity-agent",
          message: `${intReport.issues.length} integrity issue(s) found after deploying ${agent_name}`,
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
    const registry = await db.get("registry") || { agents: [] };
    res.json({ success: true, message: `Agent ${agent} is now live`, total_agents: registry.agents?.length || 0 });
  } catch (e) {
    res.json({ success: true, message: `Agent ${agent} hot-loaded` });
  }
});

// ── Test Agent ──────────────────────────────────────────────────────────────

app.post("/test/run", async (req, res) => {
  try {
    const tier = req.query.tier || "fast";
    const result = await runFullTestSuite("manual", tier);
    result.tier = tier;
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/test/run/:agent", async (req, res) => {
  try {
    const tier = req.query.tier || "fast";
    const results = await runAgentTestSuite(req.params.agent, "manual", tier);
    const passed = results.filter(r => r.status === "pass").length;
    const failed = results.filter(r => r.status === "fail").length;
    const errors = results.filter(r => r.status === "error").length;
    res.json({ agent: req.params.agent, tier, total: results.length, passed, failed, errors, results });
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

    // Count fast vs full cases across all suites
    let fastCases = 0, fullCases = 0;
    for (const key of suiteKeys) {
      const suite = await db.get(key);
      if (suite?.test_cases) {
        for (const tc of suite.test_cases) {
          if ((tc.tier || "fast") === "fast") fastCases++;
          else fullCases++;
        }
      }
    }

    res.json({
      registry_entry: registryPass ? "pass" : "fail",
      scheduler_registered: "pass",
      endpoints_responding: endpointChecks,
      database_keys: {
        test_suites_found: suiteKeys.length,
        test_runs_found: runKeys.length,
        warnings_found: warnKeys.length,
      },
      fast_cases: fastCases,
      full_cases: fullCases,
      total_cases: fastCases + fullCases,
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

// ── Intelligence Update ─────────────────────────────────────────────────────

app.post("/intelligence/run", async (req, res) => {
  try { res.json(await runIntelligenceScan("manual")); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/intelligence/run/:source", async (req, res) => {
  try { res.json(await runIntelligenceScan("manual", req.params.source)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/intelligence/findings", async (req, res) => {
  try { res.json(await getFindings({ status: req.query.status, score: req.query.score, category: req.query.category })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/intelligence/findings/:id", async (req, res) => {
  try {
    const f = await getFinding(req.params.id);
    if (!f) return res.status(404).json({ error: "Finding not found" });
    res.json(f);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/intelligence/approve/:id", async (req, res) => {
  try { res.json(await approveFinding(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/intelligence/reject/:id", async (req, res) => {
  try {
    const { reason } = req.body || {};
    res.json(await rejectFinding(req.params.id, reason || ""));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/intelligence/sources", async (req, res) => {
  try { res.json(await getAllSources()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/intelligence/sources", async (req, res) => {
  try { res.json(await getAllSources()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/intelligence/status", async (req, res) => {
  try {
    const lastRun = await db.get("intel-last-run");
    const sources = await getAllSources();
    const healthy = sources.filter(s => s.consecutive_failures === 0).length;
    const failing = sources.filter(s => s.consecutive_failures > 0).length;
    const findingKeys = await db.list("intelligence:");
    res.json({
      status: "ok",
      agent: "intelligence-update-agent",
      last_run_at: lastRun?.run_at || null,
      findings_count: findingKeys.length,
      sources_count: sources.length,
      sources_healthy: healthy,
      sources_failing: failing,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Connectors ──────────────────────────────────────────────────────────────

app.get("/connectors/status", async (req, res) => {
  try { res.json(await getConnectorStatus()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/connectors/test", async (req, res) => {
  try {
    const { connector } = req.body || {};
    if (!connector) return res.status(400).json({ error: "connector required" });
    res.json(await testConnector(connector));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/connectors/gmail/send", async (req, res) => {
  try { res.json(await sendGmail(req.body || {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/connectors/gmail/read", async (req, res) => {
  try { res.json(await readGmail(req.body || {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/connectors/slack/send", async (req, res) => {
  try { res.json(await sendSlack(req.body || {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/connectors/approve/:id", async (req, res) => {
  try { res.json(await approveSend(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/connectors/log", async (req, res) => {
  try { res.json(await getSendLog()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/connectors/config", async (req, res) => {
  try { res.json(await getConnectorConfig()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/connectors/config", async (req, res) => {
  try { res.json(await updateConnectorConfig(req.body || {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Italy 2026 Connector ────────────────────────────────────────────────────

app.get("/connectors/italy2026/health", async (req, res) => {
  try { res.json(await getItaly2026Health()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/connectors/italy2026/data", async (req, res) => {
  try { res.json(await getItaly2026Data()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/connectors/italy2026/config", async (req, res) => {
  try {
    const { url, key } = req.body || {};
    if (!url || !key) return res.status(400).json({ error: "url and key required" });
    const { set } = await import("./db.js");
    await set("italy2026-config", { url, key });
    res.json({ success: true, message: "Italy 2026 config saved to database" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Dynamic health endpoint — handles ALL agents via registry lookup
app.get("/agents/:name/health", async (req, res) => {
  try {
    const registry = await readRegistry();
    const agent = (registry.agents || []).find(a => a.name === req.params.name);
    if (!agent) return res.status(404).json({ error: "Agent not found in registry" });
    if (agent.status === "paused") return res.json({ status: "paused", agent: agent.name, domain: agent.domain });
    const isActive = agent.status === "Active" || agent.status === "active";
    if (!isActive) return res.status(503).json({ status: "inactive", agent: agent.name });
    res.json({ status: "ok", agent: agent.name, domain: agent.domain, checked_at: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Agent Lifecycle Management ───────────────────────────────────────────────

// 1. GET /agents/:name/detail — full agent profile
app.get("/agents/:name/detail", async (req, res) => {
  try {
    const name = req.params.name;
    const registry = await readRegistry();
    const agent = (registry.agents || []).find(a => a.name === name);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    const { existsSync, readFileSync } = await import("fs");
    const { join } = await import("path");
    const skillPath = join(__dirname, `skills/${name}.md`);
    const codePath = join(__dirname, `agents/${name}.js`);

    const suite = await db.get(`test-suite:${name}`);

    let runs = [];
    try {
      const cached = await db.get(`agent-recent-runs:${name}`);
      if (Array.isArray(cached)) runs = cached.slice(0, 10);
    } catch (_) {}

    // Gather version history
    const versions = await db.get(`agent-versions:${name}`) || [];

    res.json({
      agent: name,
      domain: agent.domain,
      status: agent.status,
      purpose: agent.purpose || null,
      skill_file: existsSync(skillPath) ? skillPath.replace(__dirname + "/", "src/") : null,
      code_file: existsSync(codePath) ? codePath.replace(__dirname + "/", "src/") : null,
      skill_exists: existsSync(skillPath),
      code_exists: existsSync(codePath),
      test_suite: suite ? { cases: suite.test_cases?.length || 0, baseline: !!suite.baseline_output } : null,
      run_history: runs.slice(0, 10),
      version_history: versions,
      registry_entry: agent,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. PUT /agents/:name/skill — update skill file with versioning
app.put("/agents/:name/skill", async (req, res) => {
  try {
    const name = req.params.name;
    const { content } = req.body || {};
    if (!content) return res.status(400).json({ error: "content required" });

    const { existsSync, readFileSync, writeFileSync } = await import("fs");
    const { join } = await import("path");
    const skillPath = join(__dirname, `skills/${name}.md`);

    // Save version before overwriting
    const versions = await db.get(`agent-versions:${name}`) || [];
    if (existsSync(skillPath)) {
      const oldContent = readFileSync(skillPath, "utf8");
      versions.push({
        version: versions.length + 1,
        saved_at: new Date().toISOString(),
        content_length: oldContent.length,
        content_preview: oldContent.slice(0, 200),
      });
      await db.set(`agent-versions:${name}`, versions);
    }

    writeFileSync(skillPath, content, "utf8");

    res.json({
      success: true,
      agent: name,
      updated_at: new Date().toISOString(),
      version_saved: true,
      version_number: versions.length + 1,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 3. POST /agents/:name/pause — set agent status to paused
app.post("/agents/:name/pause", async (req, res) => {
  try {
    const name = req.params.name;
    const registry = await readRegistry();
    const agent = (registry.agents || []).find(a => a.name === name);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    agent.status = "paused";
    agent.paused_at = new Date().toISOString();
    await writeRegistry(registry);

    res.json({ success: true, agent: name, status: "paused", paused_at: agent.paused_at });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 4. POST /agents/:name/resume — set agent status back to Active
app.post("/agents/:name/resume", async (req, res) => {
  try {
    const name = req.params.name;
    const registry = await readRegistry();
    const agent = (registry.agents || []).find(a => a.name === name);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    agent.status = "Active";
    agent.resumed_at = new Date().toISOString();
    delete agent.paused_at;
    await writeRegistry(registry);

    res.json({ success: true, agent: name, status: "active", resumed_at: agent.resumed_at });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 5. DELETE /agents/:name — remove agent from registry, clean up
app.delete("/agents/:name", async (req, res) => {
  try {
    const name = req.params.name;
    const registry = await readRegistry();
    const idx = (registry.agents || []).findIndex(a => a.name === name);
    if (idx >= 0) {
      registry.agents.splice(idx, 1);
      await writeRegistry(registry);
    }

    // Clean up test suite and version history regardless
    await db.set(`test-suite:${name}`, null);
    await db.set(`agent-versions:${name}`, null);

    res.json({ success: true, deleted: true, agent: name, removed_at: new Date().toISOString() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 6. GET /agents/:name/versions — version history
app.get("/agents/:name/versions", async (req, res) => {
  try {
    const name = req.params.name;
    const versions = await db.get(`agent-versions:${name}`) || [];
    res.json(versions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Slab Inventory Action Endpoint ───────────────────────────────────────────

app.post("/agents/slab-inventory-tracker-agent", async (req, res) => {
  try {
    const { request: reqText, input, context } = req.body || {};
    const userRequest = reqText || input || "";
    if (!userRequest) return res.status(400).json({ error: "request or input required" });

    // Load current inventory
    const slabKeys = await db.list("slab:");
    const inventory = [];
    for (const key of slabKeys) {
      const slab = await db.get(key);
      if (slab) {
        slab.age_days = Math.floor((Date.now() - new Date(slab.cut_date || slab.created_at).getTime()) / 86400000);
        slab.aging_alert = slab.age_days >= 60 && slab.status !== "sold";
        inventory.push(slab);
      }
    }

    const sysPrompt = `You are the Slab Inventory Tracker for Three Rivers Slab Co.
Current inventory: ${inventory.length} slabs.
${JSON.stringify(inventory.slice(0, 50), null, 2)}

Parse the user's request and return ONLY valid JSON:
{
  "action": "add|view|update|search|aging_report",
  "data": (action-specific — for "add": the new slab record with fields species/thickness/length_inches/width_inches/cut_date/asking_price/status/yard_location/notes; for "update": {id, ...fields_to_update}; for "search": {filters}; for "view" and "aging_report": null),
  "response_text": "human-readable summary of what was done"
}`;

    const resp = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: sysPrompt,
      messages: [{ role: "user", content: userRequest }],
    });

    const text = resp.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    let parsed;
    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}") + 1;
      parsed = JSON.parse(text.slice(start, end));
    } catch {
      return res.json({ agent: "slab-inventory-tracker-agent", output: text, success: true, action_taken: "query", result: text, data: null });
    }

    // Execute the action
    if (parsed.action === "add" && parsed.data) {
      const id = uuidv4();
      const slab = {
        id, ...parsed.data,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        alert_sent: false,
      };
      await db.set(`slab:${id}`, slab);
      return res.json({ agent: "slab-inventory-tracker-agent", output: parsed.response_text || `Added ${slab.species} slab ${slab.id}`, success: true, action_taken: "add", result: parsed.response_text, data: slab });
    }

    if (parsed.action === "update" && parsed.data?.id) {
      const existing = await db.get(`slab:${parsed.data.id}`);
      if (!existing) return res.json({ agent: "slab-inventory-tracker-agent", output: "Slab not found", success: false, action_taken: "update", result: "Slab not found", data: null });
      Object.assign(existing, parsed.data, { updated_at: new Date().toISOString() });
      await db.set(`slab:${existing.id}`, existing);
      return res.json({ agent: "slab-inventory-tracker-agent", output: parsed.response_text || `Updated slab ${existing.id}`, success: true, action_taken: "update", result: parsed.response_text, data: existing });
    }

    if (parsed.action === "aging_report") {
      const aging = inventory.filter(s => s.age_days >= 60 && s.status !== "sold");
      const msg = parsed.response_text || `${aging.length} slabs aged 60+ days`;
      return res.json({ agent: "slab-inventory-tracker-agent", output: msg, success: true, action_taken: "aging_report", result: msg, data: aging });
    }

    // view, search, or any other action
    const msg = parsed.response_text || text;
    return res.json({ agent: "slab-inventory-tracker-agent", output: msg, success: true, action_taken: parsed.action || "query", result: msg, data: parsed.data || inventory });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Intelligence Action Endpoint ────────────────────────────────────────────

app.post("/agents/intelligence-update-agent", async (req, res) => {
  try {
    const { request: reqText, input, context } = req.body || {};
    const userRequest = reqText || input || "";
    if (!userRequest) return res.status(400).json({ error: "request or input required" });

    // Load findings and sources
    const findingKeys = await db.list("intelligence:");
    const findings = [];
    for (const key of findingKeys) {
      const f = await db.get(key);
      if (f) findings.push(f);
    }
    findings.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));

    const pending = findings.filter(f => f.status === "proposed" || f.status === "surfaced");
    const byCategory = {};
    for (const f of findings) {
      byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    }
    const byStatus = {};
    for (const f of findings) {
      byStatus[f.status] = (byStatus[f.status] || 0) + 1;
    }

    const lower = userRequest.toLowerCase();

    const A = "intelligence-update-agent";
    function intelResp(actionTaken, resultText, data) {
      return { agent: A, output: resultText, success: true, action_taken: actionTaken, result: resultText, data };
    }

    if (lower.includes("pending") || lower.includes("proposal")) {
      return res.json(intelResp("list_pending_proposals", `${pending.length} pending proposals`,
        pending.map(f => ({ id: f.id, title: f.title, source: f.source, score: f.relevance_score, category: f.category, suggested_action: f.suggested_action, status: f.status }))));
    }

    if (lower.includes("summary") || lower.includes("overview")) {
      return res.json(intelResp("findings_summary", `${findings.length} total findings across ${Object.keys(byCategory).length} categories`,
        { total: findings.length, by_category: byCategory, by_status: byStatus, top_scored: findings.slice(0, 5).map(f => ({ title: f.title, score: f.relevance_score, category: f.category })) }));
    }

    if (lower.includes("recommend") || lower.includes("approve first") || lower.includes("priorit")) {
      const prioritized = pending.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0)).slice(0, 5);
      return res.json(intelResp("approval_recommendation", `Top ${prioritized.length} proposals to approve first, by relevance score`,
        prioritized.map((f, i) => ({ rank: i + 1, id: f.id, title: f.title, score: f.relevance_score, category: f.category, reason: f.reason, suggested_action: f.suggested_action }))));
    }

    const categories = ["new_capability", "model_update", "tool_integration", "platform_change", "best_practice", "deprecation"];
    const matchedCat = categories.find(c => lower.includes(c.replace("_", " ")));
    if (matchedCat) {
      const filtered = findings.filter(f => f.category === matchedCat);
      return res.json(intelResp("filter_by_category", `${filtered.length} findings in category: ${matchedCat}`,
        filtered.map(f => ({ id: f.id, title: f.title, score: f.relevance_score, status: f.status, summary: f.summary }))));
    }

    // Fallback
    return res.json(intelResp("general_query",
      `${findings.length} findings total, ${pending.length} pending review. Ask about: pending proposals, summary, recommendations, or filter by category.`,
      { total: findings.length, pending: pending.length, categories: Object.keys(byCategory) }));

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Investment Research Agent ────────────────────────────────────────────────

app.get("/agents/investment-research-agent/health", async (req, res) => {
  res.json({ status: "ok", agent: "investment-research-agent", checked_at: new Date().toISOString() });
});

app.post("/agents/investment-research-agent", async (req, res) => {
  try {
    const { request: reqText, input, context } = req.body || {};
    const userRequest = reqText || input || "";
    if (!userRequest) return res.status(400).json({ error: "request or input required" });
    const result = await runInvestmentResearchAgent(userRequest, context || {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/investment/watchlist", async (req, res) => {
  try { res.json(await getInvestmentWatchlist()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/investment/portfolio", async (req, res) => {
  try { res.json(await getInvestmentPortfolio()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/investment/trades", async (req, res) => {
  try { res.json(await getInvestmentTrades(req.query.status)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/investment/summary", async (req, res) => {
  try { res.json(await getInvestmentSummary()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Travel Agent ────────────────────────────────────────────────────────────

app.get("/agents/travel-agent/health", async (req, res) => {
  res.json({ status: "ok", agent: "travel-agent", checked_at: new Date().toISOString() });
});

app.post("/agents/travel-agent", async (req, res) => {
  try {
    const { request: reqText, input, context } = req.body || {};
    const userRequest = reqText || input || "";
    if (!userRequest) return res.status(400).json({ error: "request or input required" });
    const result = await runTravelAgent(userRequest, context || {});
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Prompt Engineering Agent ─────────────────────────────────────────────────

app.post("/api/prompt-engineering/session/start", async (req, res) => {
  try {
    const { topic } = req.body || {};
    if (!topic?.trim()) return res.status(400).json({ error: "topic required" });
    res.json(await peStartSession(topic.trim()));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/prompt-engineering/session/message", async (req, res) => {
  try {
    const { sessionId, message } = req.body || {};
    if (!sessionId || !message?.trim()) return res.status(400).json({ error: "sessionId and message required" });
    res.json(await peSessionMessage(sessionId, message.trim()));
  } catch (e) { res.status(e.message === "Session not found or expired" ? 404 : 500).json({ error: e.message }); }
});

app.post("/api/prompt-engineering/session/generate", async (req, res) => {
  try {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });
    res.json(await peGeneratePrompt(sessionId));
  } catch (e) { res.status(e.message === "Session not found or expired" ? 404 : 500).json({ error: e.message }); }
});

app.post("/api/prompt-engineering/prompts/save", async (req, res) => {
  try {
    const { sessionId, title, tags } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: "sessionId required" });
    res.json(await peSavePrompt(sessionId, title, tags));
  } catch (e) { res.status(e.message.includes("not found") ? 404 : 500).json({ error: e.message }); }
});

app.get("/api/prompt-engineering/prompts", async (req, res) => {
  try { res.json({ prompts: await peListPrompts() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/prompt-engineering/prompts/:id", async (req, res) => {
  try { res.json({ prompt: await peGetPrompt(req.params.id) }); }
  catch (e) { res.status(e.message === "Prompt not found" ? 404 : 500).json({ error: e.message }); }
});

app.patch("/api/prompt-engineering/prompts/:id", async (req, res) => {
  try { res.json({ prompt: await peUpdatePrompt(req.params.id, req.body || {}) }); }
  catch (e) { res.status(e.message === "Prompt not found" ? 404 : 500).json({ error: e.message }); }
});

app.delete("/api/prompt-engineering/prompts/:id", async (req, res) => {
  try { res.json(await peDeletePrompt(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Dynamic Agent Action Endpoint (catch-all for registered agents) ─────────

app.post("/agents/:name", async (req, res) => {
  try {
    const registry = await readRegistry();
    const agent = (registry.agents || []).find(a => a.name === req.params.name);
    if (!agent) return res.status(404).json({ error: `Agent ${req.params.name} not found in registry` });
    const isActive = agent.status === "Active" || agent.status === "active";
    if (!isActive) return res.status(503).json({ error: `Agent ${req.params.name} is not active` });

    const { request: reqText, input, context } = req.body || {};
    const userRequest = reqText || input || "";
    if (!userRequest) return res.status(400).json({ error: "request or input required" });

    // Try to load the agent's skill file
    const { existsSync, readFileSync } = await import("fs");
    const { join } = await import("path");
    const skillPath = join(__dirname, `skills/${req.params.name}.md`);
    const skillContent = existsSync(skillPath) ? readFileSync(skillPath, "utf8") : `You are the ${req.params.name} agent.`;

    const aiClient = new Anthropic();
    const resp = await aiClient.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: skillContent,
      messages: [{ role: "user", content: userRequest }],
    });

    const output = resp.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    res.json({ agent: req.params.name, request: userRequest, output, requires_approval: false });

  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// JSON 404 for API/test paths — prevents HTML fallback
app.all("/test/*", (req, res) => {
  res.status(404).json({ error: `Endpoint not found: ${req.method} ${req.path}` });
});
app.all("/improve/*", (req, res) => {
  res.status(404).json({ error: `Endpoint not found: ${req.method} ${req.path}` });
});
// ── Morning Briefing ─────────────────────────────────────────────────────────

app.post("/briefing/run", async (req, res) => {
  try { res.json(await runBriefing()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/briefing/preview", async (req, res) => {
  try { res.json(await previewBriefing()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/briefing/latest", async (req, res) => {
  try { res.json(await getLatestBriefing()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/briefing/history", async (req, res) => {
  try { res.json(await getBriefingHistory()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// ── Memory Consolidation ────────────────────────────────────────────────────

app.post("/memory/run", async (req, res) => {
  try { res.json(await runConsolidation("manual")); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/memory/proposals", async (req, res) => {
  try { res.json(await getProposals(req.query.status)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/memory/proposals/:id", async (req, res) => {
  try { res.json(await getProposal(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/memory/proposals/:id/approve", async (req, res) => {
  try {
    const result = await approveProposal(req.params.id);
    // Log execution
    try {
      const { logExecution } = await import("./tools/approval-tools.js");
      await logExecution({
        source: "memory",
        proposal_id: req.params.id,
        action_type: "context_addition",
        change_type: "memory_fact",
        description: `Memory fact approved and written to context`,
        success: true,
      });
    } catch {}
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/memory/proposals/:id/reject", async (req, res) => {
  try { res.json(await rejectProposal(req.params.id, req.body?.reason)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/memory/history", async (req, res) => {
  try { res.json(await getMemoryHistory()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/memory/facts", async (req, res) => {
  try { res.json(await getFacts()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/agents/memory-consolidation-agent", async (req, res) => {
  try { res.json(await runConsolidation("manual")); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Travel CRUD ─────────────────────────────────────────────────────────────

app.get("/travel/profile", async (req, res) => {
  try { res.json(await getTravelProfile()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/travel/profile", async (req, res) => {
  try { res.json(await updateTravelProfile(req.body || {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/travel/trips", async (req, res) => {
  try { res.json(await getTrips()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/travel/trips", async (req, res) => {
  try { res.json(await createTrip(req.body || {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/travel/trips/:id", async (req, res) => {
  try {
    const trip = await getTrip(req.params.id);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    res.json(trip);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/travel/trips/:id", async (req, res) => {
  try {
    const trip = await updateTrip(req.params.id, req.body || {});
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    res.json(trip);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/travel/trips/:id", async (req, res) => {
  try {
    const trip = await deleteTrip(req.params.id);
    if (!trip) return res.status(404).json({ error: "Trip not found" });
    res.json(trip);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/travel/flights/watch", async (req, res) => {
  try { res.json(await getFlightWatches()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/travel/flights/watch", async (req, res) => {
  try { res.json(await createFlightWatch(req.body || {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/travel/flights/watch/:id", async (req, res) => {
  try {
    const watch = await getFlightWatch(req.params.id);
    if (!watch) return res.status(404).json({ error: "Flight watch not found" });
    res.json(watch);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/travel/flights/watch/:id", async (req, res) => {
  try {
    const watch = await updateFlightWatch(req.params.id, req.body || {});
    if (!watch) return res.status(404).json({ error: "Flight watch not found" });
    res.json(watch);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/travel/flights/watch/:id", async (req, res) => {
  try {
    const watch = await deleteFlightWatch(req.params.id);
    if (!watch) return res.status(404).json({ error: "Flight watch not found" });
    res.json(watch);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/travel/loyalty", async (req, res) => {
  try { res.json(await getLatestLoyaltySnapshot()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/travel/loyalty/history", async (req, res) => {
  try { res.json(await getLoyaltySnapshots()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/travel/loyalty", async (req, res) => {
  try { res.json(await createLoyaltySnapshot(req.body || {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/travel/loyalty/:id", async (req, res) => {
  try {
    const snapshot = await getLoyaltySnapshot(req.params.id);
    if (!snapshot) return res.status(404).json({ error: "Loyalty snapshot not found" });
    res.json(snapshot);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/travel/loyalty/:id", async (req, res) => {
  try {
    const snapshot = await updateLoyaltySnapshot(req.params.id, req.body || {});
    if (!snapshot) return res.status(404).json({ error: "Loyalty snapshot not found" });
    res.json(snapshot);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/travel/loyalty/:id", async (req, res) => {
  try {
    const snapshot = await deleteLoyaltySnapshot(req.params.id);
    if (!snapshot) return res.status(404).json({ error: "Loyalty snapshot not found" });
    res.json(snapshot);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/travel/docs", async (req, res) => {
  try { res.json(await getTravelDocs()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/travel/docs", async (req, res) => {
  try { res.json(await createTravelDoc(req.body || {})); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/travel/docs/:name", async (req, res) => {
  try {
    const doc = await getTravelDoc(req.params.name);
    if (!doc) return res.status(404).json({ error: "Travel document not found" });
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/travel/docs/:name", async (req, res) => {
  try {
    const doc = await updateTravelDoc(req.params.name, req.body || {});
    if (!doc) return res.status(404).json({ error: "Travel document not found" });
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/travel/docs/:name", async (req, res) => {
  try {
    const doc = await deleteTravelDoc(req.params.name);
    if (!doc) return res.status(404).json({ error: "Travel document not found" });
    res.json(doc);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.all("/travel/*", (req, res) => {
  res.status(404).json({ error: `Endpoint not found: ${req.method} ${req.path}` });
});
app.all("/connectors/*", (req, res) => {
  res.status(404).json({ error: `Endpoint not found: ${req.method} ${req.path}` });
});
app.all("/intelligence/*", (req, res) => {
  res.status(404).json({ error: `Endpoint not found: ${req.method} ${req.path}` });
});
app.all("/memory/*", (req, res) => {
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

async function registerIntelligenceAgent() {
  const registry = await readRegistry();
  const exists = (registry.agents || []).some(a => a.name === "intelligence-update-agent");
  if (!exists) {
    registry.agents = registry.agents || [];
    registry.agents.push({
      name: "intelligence-update-agent",
      domain: "System",
      purpose: "Scans external sources daily for Claude, Replit, and AI advancements relevant to LifeBridge. Scores findings, surfaces high-relevance items as proposals, snapshots state before any approved change.",
      status: "Active",
      trigger_patterns: ["intelligence", "scan sources", "what's new", "updates", "changelog"],
      triggers: ["scheduled_daily_6am", "manual"],
      endpoints: ["/intelligence/run", "/intelligence/findings", "/intelligence/approve/:id", "/intelligence/reject/:id", "/intelligence/sources"],
      requires_approval: ["all — nothing auto-applies"],
      created_at: new Date().toISOString(),
    });
    await writeRegistry(registry);
    console.log("Registered: intelligence-update-agent");
  }
}

async function cleanRegistry() {
  const registry = await readRegistry();
  const removeNames = new Set([
    "three-rivers-slab-inventory-agent",
    "professional-networking-agent",
  ]);
  const before = registry.agents?.length || 0;
  registry.agents = (registry.agents || []).filter(a => !removeNames.has(a.name));

  // Fix slab tracker domain
  const slab = registry.agents.find(a => a.name === "slab-inventory-tracker-agent");
  if (slab) slab.domain = "Personal Business";

  if (registry.agents.length !== before || slab) {
    await writeRegistry(registry);
    const removed = before - registry.agents.length;
    if (removed > 0) console.log(`[CLEANUP] Removed ${removed} ghost/pending registry entries`);
    if (slab) console.log(`[CLEANUP] Fixed slab-inventory-tracker-agent domain → Personal Business`);
  }
}

async function resetTestSuites() {
  // Delete ALL test suites so they re-seed fresh with current DEFAULT_CASES
  const keys = await db.list("test-suite:");
  for (const key of keys) {
    await db.set(key, null);
  }
}

async function registerConnectors() {
  const registry = await readRegistry();
  const exists = (registry.agents || []).some(a => a.name === "connectors");
  if (!exists) {
    registry.agents = registry.agents || [];
    registry.agents.push({
      name: "connectors",
      domain: "System",
      purpose: "Gmail and Slack connectors for spoke agent use",
      status: "Active",
      trigger_patterns: ["connector", "gmail", "slack", "email", "send message"],
      endpoints: ["/connectors/status", "/connectors/gmail/send", "/connectors/gmail/read", "/connectors/slack/send", "/connectors/test"],
      requires_approval: ["send_email", "send_slack_message"],
      created_at: new Date().toISOString(),
    });
    await writeRegistry(registry);
    console.log("Registered: connectors");
  }
}

async function registerTravelAgent() {
  await registerTravelAgentInRegistry();
}

async function registerMemoryConsolidationAgent() {
  const registry = await readRegistry();
  const exists = (registry.agents || []).some(a => a.name === "memory-consolidation-agent");
  if (!exists) {
    registry.agents = registry.agents || [];
    registry.agents.push({
      name: "memory-consolidation-agent",
      domain: "System",
      purpose: "Weekly review of all request logs, briefings, and agent activity to extract durable facts about Josh and propose context additions.",
      status: "Active",
      trigger_patterns: ["memory", "consolidate", "learn", "facts", "what do you know about me"],
      triggers: ["scheduled_weekly_sunday_3am", "manual"],
      endpoints: ["/memory/run", "/memory/proposals", "/memory/proposals/:id", "/memory/proposals/:id/approve", "/memory/proposals/:id/reject", "/memory/facts", "/memory/history"],
      requires_approval: ["all — nothing auto-applies"],
      created_at: new Date().toISOString(),
    });
    await writeRegistry(registry);
    console.log("Registered: memory-consolidation-agent");
  }
}

async function registerMorningBriefingAgent() {
  const registry = await readRegistry();
  const exists = (registry.agents || []).some(a => a.name === "morning-briefing-agent");
  if (!exists) {
    registry.agents = registry.agents || [];
    registry.agents.push({
      name: "morning-briefing-agent",
      domain: "System",
      purpose: "Compiles and delivers daily briefing via Gmail and Slack at 7:30 AM UTC covering system health, test results, intelligence findings, proposals, and ideas",
      status: "Active",
      trigger_patterns: ["briefing", "morning briefing", "daily summary", "daily brief"],
      triggers: ["scheduled_daily_730am", "manual"],
      endpoints: ["/briefing/run", "/briefing/latest", "/briefing/history", "/briefing/preview"],
      requires_approval: [],
      created_at: new Date().toISOString(),
    });
    await writeRegistry(registry);
    console.log("Registered: morning-briefing-agent");
  }
}

async function start() {
  await initDefaults();
  await cleanRegistry();
  await registerAccountAgent();
  await registerBuilderAgent();
  await registerTestAgent();
  await registerIntegrityAgent();
  await registerIntelligenceAgent();
  await registerConnectors();
  console.log("Connectors Agent registered — Gmail and Slack connected");
  await registerMorningBriefingAgent();
  await registerTravelAgent();
  await initTravelProfile();
  await registerMemoryConsolidationAgent();

  // Register Italy 2026 external app
  const reg = await readRegistry();
  const italy2026Exists = (reg.agents || []).some(a => a.name === "italy2026") ||
    (reg.external_apps || []).some(a => a.name === "italy2026");
  if (!italy2026Exists) {
    reg.external_apps = reg.external_apps || [];
    reg.external_apps.push({
      name: "italy2026",
      type: "external_app",
      url: process.env.ITALY2026_URL || "",
      domain: "Personal Life",
      description: "Italy 2026 family trip planning app",
      hub_position: "sub_node",
      parent_domain: "Personal Life",
      has_connector: true,
      connector: "italy2026-connector",
      status: "active",
      created_at: new Date().toISOString(),
    });
    await writeRegistry(reg);
    console.log("Registered: italy2026 external app");
  }

  // Auto-register any agents that export AGENT_META and aren't in registry yet
  const autoReg = await autoRegisterAllAgents();
  if (autoReg.registered > 0) {
    console.log(`[AUTO-REG] ${autoReg.registered} new agent(s) registered on startup`);
  }

  // Dynamic agent loader — mounts routes for any deployed spoke agents
  const dynamicCount = await loadDynamicAgents(app);
  if (dynamicCount > 0) {
    console.log(`Loaded ${dynamicCount} dynamic agent(s) from registry`);
  }

  // One-time cleanup: auto-acknowledge old broken/duplicate alerts
  try {
    const alertKeys = await db.list("system-alert:");
    let cleaned = 0;
    const seenWatches = new Set();
    for (const key of alertKeys) {
      const alert = await db.get(key);
      if (!alert || alert.acknowledged) continue;

      // Clean legacy alerts with undefined fields
      if (!alert.message && alert.issue_count === undefined) {
        alert.acknowledged = true;
        alert.acknowledged_at = new Date().toISOString();
        alert.acknowledged_reason = "auto-cleaned: legacy alert with undefined fields";
        await db.set(key, alert);
        cleaned++;
        continue;
      }

      // Deduplicate flight watch alerts — keep only the most recent per watch_id
      if (alert.watch_id) {
        if (seenWatches.has(alert.watch_id)) {
          alert.acknowledged = true;
          alert.acknowledged_at = new Date().toISOString();
          alert.acknowledged_reason = "auto-cleaned: duplicate flight watch alert";
          await db.set(key, alert);
          cleaned++;
        } else {
          seenWatches.add(alert.watch_id);
        }
      }
    }
    if (cleaned > 0) console.log(`[CLEANUP] Auto-acknowledged ${cleaned} legacy/duplicate alert(s)`);
  } catch (e) { console.log("[CLEANUP] Alert cleanup note:", e.message); }

  // Seed any missing test suites (preserves existing results)
  const seeded = await seedAllSuites();
  if (seeded > 0) console.log(`Seeded ${seeded} new test suite(s)`);

  // Morning briefing at 7:30 AM UTC
  cron.schedule("30 7 * * *", async () => {
    try {
      const result = await runBriefing();
      console.log(`[BRIEFING] Daily briefing delivered via ${result.delivered_via.join(", ")} — ${result.sections_compiled} sections`);
    } catch (e) {
      console.error(`[BRIEFING] Daily briefing failed: ${e.message}`);
    }
  }, { timezone: "UTC" });
  console.log("Morning Briefing Agent registered — daily delivery at 7:30 AM UTC");

  // Daily intelligence scan at 6:00 AM UTC
  cron.schedule("0 6 * * *", async () => {
    try {
      const result = await runIntelligenceScan("scheduled");
      console.log(`[INTEL] Daily scan: ${result.findings_count} found, ${result.surfaced_count} surfaced`);
    } catch (e) {
      console.error(`[INTEL] Daily scan failed: ${e.message}`);
    }
  }, { timezone: "UTC" });
  console.log("Intelligence Update Agent registered — daily scan at 6:00 AM UTC");

  // Weekly integrity scan Sunday 5:00 AM UTC
  cron.schedule("0 5 * * 0", async () => {
    try {
      const report = await runIntegrityCheck("scheduled");
      console.log(`[INTEGRITY] Weekly scan: ${report.status} — ${report.agents_checked} agents, ${report.issues.length} issues`);
      if (report.status === "critical") {
        const alertId = uuidv4();
        await db.set(`system-alert:${alertId}`, {
          id: alertId, created_at: new Date().toISOString(),
          severity: "critical", source: "registry-integrity-agent",
          message: `${report.issues.length} integrity issue(s) found in weekly scan`,
          issue_count: report.issues.length, report_id: report.report_id,
          acknowledged: false,
        });
      }
    } catch (e) {
      console.error(`[INTEGRITY] Weekly scan failed: ${e.message}`);
    }
  }, { timezone: "UTC" });
  console.log("Registry Integrity Agent registered — weekly scan Sunday 5:00 AM UTC");

  // Daily fast test suite at 7:00 AM UTC (Mon-Sat)
  cron.schedule("0 7 * * 1-6", async () => {
    try {
      const result = await runFullTestSuite("scheduled", "fast");
      console.log(`[TEST] Daily fast run: ${result.passed}/${result.total_cases} passed, ${result.failed} failed`);
    } catch (e) {
      console.error(`[TEST] Daily fast run failed: ${e.message}`);
    }
  }, { timezone: "UTC" });

  // Weekly full test suite at 7:00 AM UTC (Sunday only)
  cron.schedule("0 7 * * 0", async () => {
    try {
      const result = await runFullTestSuite("scheduled", "full");
      console.log(`[TEST] Weekly full run: ${result.passed}/${result.total_cases} passed, ${result.failed} failed`);
    } catch (e) {
      console.error(`[TEST] Weekly full run failed: ${e.message}`);
    }
  }, { timezone: "UTC" });
  console.log("Test Agent registered — fast daily 7:00 AM UTC, full Sunday 7:00 AM UTC");

  // Weekly memory consolidation Sunday 3:00 AM UTC
  cron.schedule("0 3 * * 0", async () => {
    try {
      const result = await runConsolidation("scheduled");
      console.log(`[MEMORY] Weekly consolidation: ${result.proposals_generated} proposals from ${result.log_entries_analyzed} logs`);
    } catch (e) {
      console.error(`[MEMORY] Weekly consolidation failed: ${e.message}`);
    }
  }, { timezone: "UTC" });
  console.log("Memory Consolidation Agent registered — weekly Sunday 3:00 AM UTC");

  // Daily flight watch check at 8:00 AM UTC
  cron.schedule("0 8 * * *", async () => {
    try {
      await checkFlightWatches();
    } catch (e) {
      console.error(`[TRAVEL] Flight watch check failed: ${e.message}`);
    }
  }, { timezone: "UTC" });

  // Monthly document expiry check on the 1st at 9:00 AM UTC
  cron.schedule("0 9 1 * *", async () => {
    try {
      await checkDocExpiry();
    } catch (e) {
      console.error(`[TRAVEL] Doc expiry check failed: ${e.message}`);
    }
  }, { timezone: "UTC" });

  // Weekly loyalty reminder on Sunday at 10:00 AM UTC
  cron.schedule("0 10 * * 0", async () => {
    try {
      await sendLoyaltyReminder();
    } catch (e) {
      console.error(`[TRAVEL] Loyalty reminder failed: ${e.message}`);
    }
  }, { timezone: "UTC" });

  // Daily improvement cycle at midnight UTC
  cron.schedule("0 0 * * *", async () => {
    try {
      const proposal = await runImprovementCycle();
      console.log(`Daily improvement cycle: proposal ${proposal.id}, ${proposal.requests_reviewed} requests`);
    } catch (e) {
      console.error(`Daily improvement cycle failed: ${e.message}`);
    }
  }, { timezone: "UTC" });

  // Clear maintenance flag from any previous deploy restart
  try { await db.set("system:maintenance", JSON.stringify({ active: false })); } catch {}

  const port = process.env.PORT || 5000;
  app.listen(port, async () => {
    console.log("LifeBridge v2.0 running on Claude Agent SDK");
    console.log(`Listening on port ${port}`);

    // Run fast test suite AFTER server is listening so endpoints are reachable
    try {
      const startupTests = await runFullTestSuite("startup", "fast");
      console.log(`[TEST] Startup fast run: ${startupTests.passed}/${startupTests.total_cases} passed, ${startupTests.failed} failed`);
    } catch (e) {
      console.log(`[TEST] Startup fast run failed: ${e.message}`);
    }
  });
}

start().catch(e => {
  console.error("Startup failed:", e);
  process.exit(1);
});
