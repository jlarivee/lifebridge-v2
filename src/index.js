import express from "express";
import cron from "node-cron";
import path from "path";
import { fileURLToPath } from "url";
import { initDefaults } from "./db.js";
import { route } from "./agents/master-agent.js";
import { runImprovementCycle } from "./agents/improvement-agent.js";
import { logFeedback, readRecentLog } from "./tools/log-tools.js";
import { approveChange, rejectChange } from "./tools/approval-tools.js";
import { readRegistry } from "./tools/registry-tools.js";
import { readContext } from "./tools/context-tools.js";
import * as db from "./db.js";

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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
});

// ── Startup ─────────────────────────────────────────────────────────────────

async function start() {
  await initDefaults();

  // Daily improvement cycle at midnight UTC
  cron.schedule("0 0 * * *", async () => {
    try {
      const proposal = await runImprovementCycle();
      console.log(`Daily improvement cycle: proposal ${proposal.id}, ${proposal.requests_reviewed} requests`);
    } catch (e) {
      console.error(`Daily improvement cycle failed: ${e.message}`);
    }
  }, { timezone: "UTC" });

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log("LifeBridge v2.0 running on Claude Agent SDK");
    console.log(`Listening on port ${port}`);
  });
}

start().catch(e => {
  console.error("Startup failed:", e);
  process.exit(1);
});
