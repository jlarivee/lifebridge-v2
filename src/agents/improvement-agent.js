import Anthropic from "@anthropic-ai/sdk";
import { readRegistry } from "../tools/registry-tools.js";
import { readContext } from "../tools/context-tools.js";
import { readRecentLog } from "../tools/log-tools.js";
import * as db from "../db.js";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillContent = fs.readFileSync(path.join(__dirname, "../skills/improvement-agent.md"), "utf-8");
const masterSkillPath = path.join(__dirname, "../skills/master-agent.md");
const client = new Anthropic();

export async function runImprovementCycle() {
  // Skip if there's already a pending improvement-cycle proposal (not intelligence)
  // This prevents daily duplicates piling up when nobody reviews them
  const existingKeys = await db.list("improvement:");
  let pendingCount = 0;
  for (const key of existingKeys) {
    const existing = await db.get(key);
    if (existing && existing.status === "pending" && existing.requests_reviewed > 0) {
      pendingCount++;
    }
  }
  if (pendingCount >= 3) {
    console.log(`[IMPROVE] Skipping — ${pendingCount} pending improvement proposals already queued. Review them first.`);
    return {
      id: null,
      timestamp: new Date().toISOString(),
      status: "skipped",
      requests_reviewed: 0,
      proposal: `Skipped: ${pendingCount} pending proposals already in queue. Review existing proposals before generating new ones.`,
      approved_changes: [],
      rejected_changes: [],
    };
  }

  const masterSkill = fs.readFileSync(masterSkillPath, "utf-8");
  const registry = await readRegistry();
  const context = await readContext();
  const recentLog = await readRecentLog(50);

  // Load all improvement history
  const historyKeys = await db.list("improvement:");
  const history = [];
  for (const key of historyKeys) {
    const entry = await db.get(key);
    if (entry) history.push(entry);
  }

  // Extract rejections
  const rejections = recentLog
    .filter(e => e.outcome === "rejected" && e.feedback)
    .map(e => ({
      input: e.input,
      response_excerpt: (e.raw_response || "").slice(0, 500),
      feedback: e.feedback,
    }));

  const today = new Date().toISOString().slice(0, 10);
  const userMessage = `Here is the current master agent skill:
${masterSkill}

Here is the current registry:
${JSON.stringify(registry, null, 2)}

Here is the current global context:
${JSON.stringify(context, null, 2)}

Here are the rejection feedback entries (entries where outcome = rejected):
${rejections.length ? JSON.stringify(rejections, null, 2) : "No rejection feedback yet."}

These are the highest-priority signal. Every proposed change must first address any pattern
visible in the rejection feedback before analyzing other log patterns.

Here is the request log (last 50 entries max):
${JSON.stringify(recentLog, null, 2)}

Here is the improvement history:
${JSON.stringify(history, null, 2)}

Produce your structured improvement proposal now. Today is ${today}. You are reviewing ${recentLog.length} requests.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: skillContent,
    messages: [{ role: "user", content: userMessage }],
  });

  const proposalText = response.content.map(b => b.text || "").join("").trim();

  const proposal = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    status: "pending",
    requests_reviewed: recentLog.length,
    proposal: proposalText,
    approved_changes: [],
    rejected_changes: [],
  };

  await db.set(`improvement:${proposal.id}`, proposal);
  return proposal;
}
