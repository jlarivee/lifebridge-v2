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
import { deployAgent } from "./tools/deploy-tools.js";
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

async function start() {
  await initDefaults();
  await registerAccountAgent();
  await registerBuilderAgent();

  // Dynamic agent loader — mounts routes for any deployed spoke agents
  const dynamicCount = await loadDynamicAgents(app);
  if (dynamicCount > 0) {
    console.log(`Loaded ${dynamicCount} dynamic agent(s) from registry`);
  }

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
