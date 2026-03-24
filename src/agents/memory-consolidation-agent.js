/**
 * LifeBridge Memory Consolidation Agent
 * Weekly analysis of request logs to extract durable facts about Josh.
 * All proposals require human approval — never writes to context directly.
 */

import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import * as db from "../db.js";
import { readContext, writeContext } from "../tools/context-tools.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new Anthropic();

// ── Skill Loader ────────────────────────────────────────────────────────────

function loadSkill() {
  try {
    return fs.readFileSync(path.join(__dirname, "../skills/memory-consolidation-agent.md"), "utf-8");
  } catch {
    return "You are the LifeBridge Memory Consolidation Agent. Analyze request logs and extract durable facts about Josh.";
  }
}

// ── Data Readers ────────────────────────────────────────────────────────────

async function readRequestLogs() {
  const keys = await db.list("request:");
  const logs = [];
  for (const key of keys) {
    const entry = await db.get(key);
    if (entry) logs.push(entry);
  }
  logs.sort((a, b) => (b.created_at || b.timestamp || "").localeCompare(a.created_at || a.timestamp || ""));
  return logs;
}

async function readProposals(status) {
  const keys = await db.list("memory-proposal:");
  const proposals = [];
  for (const key of keys) {
    const p = await db.get(key);
    if (p && (!status || p.status === status)) proposals.push(p);
  }
  proposals.sort((a, b) => (b.proposed_at || "").localeCompare(a.proposed_at || ""));
  return proposals;
}

async function readConsolidationRuns() {
  const keys = await db.list("memory-run:");
  const runs = [];
  for (const key of keys) {
    const r = await db.get(key);
    if (r) runs.push(r);
  }
  runs.sort((a, b) => (b.run_at || "").localeCompare(a.run_at || ""));
  return runs;
}

// ── Core Consolidation ──────────────────────────────────────────────────────

export async function runConsolidation(trigger = "manual") {
  const startTime = Date.now();
  const runId = uuidv4();

  // 1. Read all request logs
  const logs = await readRequestLogs();
  if (logs.length === 0) {
    const run = {
      id: runId,
      run_at: new Date().toISOString(),
      trigger,
      proposals_generated: 0,
      log_entries_analyzed: 0,
      duration_ms: Date.now() - startTime,
    };
    await db.set(`memory-run:${runId}`, run);
    return {
      agent: "memory-consolidation-agent",
      output: "No request logs found to analyze. Nothing to consolidate.",
      success: true,
      run_id: runId,
      proposals_generated: 0,
    };
  }

  // 2. Read current context
  const context = await readContext();

  // 3. Call Claude to analyze patterns
  const skill = loadSkill();
  const logSummary = logs.slice(0, 200).map(l => ({
    input: l.input || l.request || "",
    domain: l.domain || "",
    confidence: l.confidence || null,
    outcome: l.outcome || null,
    feedback: l.feedback || null,
    routed_to: l.routed_to || l.agent || null,
    timestamp: l.created_at || l.timestamp || "",
  }));

  const resp = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    system: skill,
    messages: [{
      role: "user",
      content: `Analyze these ${logs.length} request logs (showing most recent ${logSummary.length}) and the current context. Extract durable facts about Josh.

CURRENT CONTEXT:
${JSON.stringify(context, null, 2)}

REQUEST LOGS:
${JSON.stringify(logSummary, null, 2)}

Return a JSON object with a "proposals" array. Each proposal must have:
- category: one of "preferences", "constraints", "learned_patterns", "people", "accounts"
- fact: the durable fact to add (string)
- evidence: brief explanation of what logs support this (string)
- confidence: 0-100 score (number)

Only propose facts with confidence >= 70. Be conservative. Do not propose sensitive data.
Return ONLY valid JSON, no markdown fences.`,
    }],
  });

  // 4. Parse proposals
  const rawText = resp.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
  let proposals = [];
  try {
    const parsed = JSON.parse(rawText);
    proposals = Array.isArray(parsed.proposals) ? parsed.proposals : [];
  } catch {
    // Try to extract JSON from the response
    const match = rawText.match(/\{[\s\S]*"proposals"[\s\S]*\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        proposals = Array.isArray(parsed.proposals) ? parsed.proposals : [];
      } catch { /* no proposals extractable */ }
    }
  }

  // 5. Store each proposal for human review
  const storedIds = [];
  for (const p of proposals) {
    if (!p.fact || !p.category) continue;
    const id = uuidv4();
    const proposal = {
      id,
      proposed_at: new Date().toISOString(),
      category: p.category,
      fact: p.fact,
      evidence: p.evidence || "",
      confidence: typeof p.confidence === "number" ? p.confidence : 50,
      status: "pending",
      reviewed_at: null,
      review_reason: null,
      run_id: runId,
    };
    await db.set(`memory-proposal:${id}`, proposal);
    storedIds.push(id);
  }

  // 6. Log the run
  const run = {
    id: runId,
    run_at: new Date().toISOString(),
    trigger,
    proposals_generated: storedIds.length,
    log_entries_analyzed: logs.length,
    duration_ms: Date.now() - startTime,
  };
  await db.set(`memory-run:${runId}`, run);

  return {
    agent: "memory-consolidation-agent",
    output: `Consolidation complete. Analyzed ${logs.length} log entries. Generated ${storedIds.length} proposal(s) for review.`,
    success: true,
    run_id: runId,
    proposals_generated: storedIds.length,
    log_entries_analyzed: logs.length,
    duration_ms: run.duration_ms,
  };
}

// ── Proposal Management ─────────────────────────────────────────────────────

export async function getProposals(status) {
  const proposals = await readProposals(status || "pending");
  return {
    agent: "memory-consolidation-agent",
    output: proposals.length > 0
      ? proposals
      : "No pending proposals.",
    success: true,
  };
}

export async function getProposal(id) {
  const proposal = await db.get(`memory-proposal:${id}`);
  if (!proposal) {
    return {
      agent: "memory-consolidation-agent",
      output: "Proposal not found.",
      success: true,
    };
  }
  return {
    agent: "memory-consolidation-agent",
    output: proposal,
    success: true,
  };
}

export async function approveProposal(id) {
  const proposal = await db.get(`memory-proposal:${id}`);
  if (!proposal) {
    return {
      success: true,
      agent: "memory-consolidation-agent",
      output: `Proposal ${id} not found. No action taken.`,
    };
  }

  if (proposal.status !== "pending") {
    return {
      success: true,
      agent: "memory-consolidation-agent",
      output: `Proposal already ${proposal.status}. No action taken.`,
    };
  }

  // Write to context
  const context = await readContext() || { preferences: [], constraints: [], learned_patterns: [] };
  const category = proposal.category;

  // Map category to context key
  const categoryMap = {
    preferences: "preferences",
    constraints: "constraints",
    learned_patterns: "learned_patterns",
    people: "learned_patterns",
    accounts: "learned_patterns",
  };
  const contextKey = categoryMap[category] || "learned_patterns";

  if (!Array.isArray(context[contextKey])) {
    context[contextKey] = [];
  }
  context[contextKey].push({
    fact: proposal.fact,
    source: "memory-consolidation-agent",
    added_at: new Date().toISOString(),
    evidence: proposal.evidence,
    confidence: proposal.confidence,
    category: proposal.category,
  });
  context.last_updated = new Date().toISOString();
  await writeContext(context);

  // Update proposal status
  proposal.status = "approved";
  proposal.reviewed_at = new Date().toISOString();
  await db.set(`memory-proposal:${id}`, proposal);

  return {
    success: true,
    agent: "memory-consolidation-agent",
    output: `Approved: "${proposal.fact}" added to context.${contextKey}`,
  };
}

export async function rejectProposal(id, reason) {
  const proposal = await db.get(`memory-proposal:${id}`);
  if (!proposal) {
    return {
      success: true,
      agent: "memory-consolidation-agent",
      output: `Proposal ${id} not found. No action taken.`,
    };
  }

  if (proposal.status !== "pending") {
    return {
      success: true,
      agent: "memory-consolidation-agent",
      output: `Proposal already ${proposal.status}. No action taken.`,
    };
  }

  proposal.status = "rejected";
  proposal.reviewed_at = new Date().toISOString();
  proposal.review_reason = reason || null;
  await db.set(`memory-proposal:${id}`, proposal);

  return {
    success: true,
    agent: "memory-consolidation-agent",
    output: `Rejected: "${proposal.fact}"${reason ? ` — ${reason}` : ""}`,
  };
}

// ── History & Facts ─────────────────────────────────────────────────────────

export async function getHistory(limit = 20) {
  const runs = await readConsolidationRuns();
  return {
    agent: "memory-consolidation-agent",
    output: runs.slice(0, limit),
    success: true,
  };
}

export async function getFacts() {
  const context = await readContext();
  return {
    agent: "memory-consolidation-agent",
    output: context || { preferences: [], constraints: [], learned_patterns: [] },
    success: true,
  };
}
