/**
 * LifeBridge Intelligence Update Agent
 * Scans external sources for Claude/Replit/AI advancements,
 * scores for relevance, surfaces proposals for human approval.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, readdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { v4 as uuidv4 } from "uuid";
import * as db from "../db.js";
import { readRegistry } from "../tools/registry-tools.js";
import { sendSystemAlert } from "./connectors.js";
import { readContext, writeContext } from "../tools/context-tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(join(__dirname, "../skills/intelligence-update-agent.md"), "utf8");
const client = new Anthropic();

const SOURCES = [
  { name: "anthropic-changelog", url: "anthropic.com/changelog", query: "Anthropic changelog latest updates Claude 2026" },
  { name: "claude-docs", url: "docs.anthropic.com", query: "Claude API documentation latest changes new features 2026" },
  { name: "replit-changelog", url: "replit.com/changelog", query: "Replit changelog latest updates 2026" },
  { name: "mcp-registry", url: "modelcontextprotocol.io", query: "Model Context Protocol MCP new servers integrations 2026" },
  { name: "hackernews-claude", url: "news.ycombinator.com", query: "Claude Anthropic AI agent latest news Hacker News 2026" },
  { name: "simon-willison", url: "simonwillison.net", query: "Simon Willison blog Claude AI tools latest 2026" },
];

// ── Source Management ───────────────────────────────────────────────────────

async function getSourceRecord(name) {
  return await db.get(`intel-source:${name}`) || {
    name,
    last_scanned_at: null,
    last_error: null,
    last_error_at: null,
    consecutive_failures: 0,
    total_scans: 0,
    total_findings: 0,
  };
}

async function saveSourceRecord(record) {
  await db.set(`intel-source:${record.name}`, record);
}

export async function getAllSources() {
  const records = [];
  for (const s of SOURCES) {
    records.push(await getSourceRecord(s.name));
  }
  return records;
}

// ── Scanning ────────────────────────────────────────────────────────────────

async function scanSource(source) {
  const record = await getSourceRecord(source.name);
  const findings = [];

  try {
    const resp = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{
        role: "user",
        content: `Search for the latest updates from ${source.url}. Query: "${source.query}"

Find items published in the last 7 days. For each item found, return ONLY valid JSON — an array of objects:
[{
  "title": "short title",
  "url": "link if available",
  "summary": "2-3 sentence summary",
  "published": "approximate date"
}]

If nothing new was found, return an empty array: []
Return ONLY the JSON array, no other text.`
      }],
    });

    const text = resp.content.filter(b => b.type === "text").map(b => b.text).join("").trim();

    // Extract JSON from response
    let items = [];
    try {
      const start = text.indexOf("[");
      const end = text.lastIndexOf("]") + 1;
      if (start >= 0 && end > start) {
        items = JSON.parse(text.slice(start, end));
      }
    } catch {}

    // Score each item
    for (const item of items) {
      const scored = await scoreItem(item, source.name);
      findings.push(scored);
      await db.set(`intelligence:${scored.id}`, scored);
    }

    // Update source record
    record.last_scanned_at = new Date().toISOString();
    record.last_error = null;
    record.consecutive_failures = 0;
    record.total_scans++;
    record.total_findings += findings.length;
    await saveSourceRecord(record);

  } catch (e) {
    record.last_error = e.message;
    record.last_error_at = new Date().toISOString();
    record.consecutive_failures++;
    record.total_scans++;
    await saveSourceRecord(record);

    if (record.consecutive_failures >= 3) {
      await db.set(`agent-warning:intel-${source.name}`, {
        agent_name: "intelligence-update-agent",
        flagged_at: new Date().toISOString(),
        reason: `source_scan_failing`,
        prior_avg: null,
        current_avg: null,
        recommended_action: `${source.name} has failed ${record.consecutive_failures} consecutive scans: ${e.message}`,
      });
    }

    console.log(`[INTEL] Source ${source.name} scan failed: ${e.message}`);
  }

  return findings;
}

async function scoreItem(item, sourceName) {
  const id = uuidv4();
  let score = 5, category = "best_practice", reason = "", suggestedAction = "";

  try {
    const resp = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `Score this finding for relevance to LifeBridge — an autonomous agent OS running on Claude Agent SDK, Replit, Express, with master agent routing, improvement agent, web search, and spoke agents.

Title: ${item.title || ""}
Summary: ${item.summary || ""}
Source: ${sourceName}

Return ONLY valid JSON:
{"score": number 1-10, "category": "new_capability|model_update|tool_integration|platform_change|best_practice|deprecation", "reason": "one sentence why this score", "suggested_action": "one sentence what to do"}`
      }],
    });

    const text = resp.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    try {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}") + 1;
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(text.slice(start, end));
        score = parsed.score || 5;
        category = parsed.category || "best_practice";
        reason = parsed.reason || "";
        suggestedAction = parsed.suggested_action || "";
      }
    } catch {}
  } catch (e) {
    reason = `Scoring failed: ${e.message}`;
  }

  return {
    id,
    found_at: new Date().toISOString(),
    source: sourceName,
    url: item.url || "",
    title: item.title || "Untitled",
    summary: item.summary || "",
    relevance_score: score,
    category,
    reason,
    suggested_action: suggestedAction,
    status: score >= 6 ? "surfaced" : "found",
    proposal_id: null,
    snapshot_id: null,
    notes: "",
  };
}

// ── Proposal Generation ─────────────────────────────────────────────────────

async function generateProposals(findings) {
  const surfaced = findings.filter(f => f.relevance_score >= 6);
  for (const finding of surfaced) {
    const proposalId = uuidv4();
    const proposal = {
      id: proposalId,
      timestamp: new Date().toISOString(),
      status: "pending",
      requests_reviewed: 0,
      proposal: `INTELLIGENCE FINDING — ${finding.title}\n` +
        `──────────────────────────\n` +
        `Source: ${finding.source}\n` +
        `Score: ${finding.relevance_score}/10 (${finding.category})\n` +
        `URL: ${finding.url}\n\n` +
        `${finding.summary}\n\n` +
        `Reason for surfacing: ${finding.reason}\n\n` +
        `PROPOSED CHANGES\n\n` +
        `Change [1]:\n` +
        `  Type:       Context addition\n` +
        `  Evidence:   Intelligence finding ${finding.id}\n` +
        `  Proposed:   ${finding.suggested_action}\n` +
        `  Reasoning:  ${finding.reason}\n` +
        `  Risk:       Low — context addition only, no code changes\n` +
        `  Confidence: ${finding.relevance_score >= 8 ? 'High' : 'Medium'}\n\n` +
        `OVERALL ASSESSMENT\n` +
        `${finding.suggested_action}`,
      approved_changes: [],
      rejected_changes: [],
    };

    await db.set(`improvement:${proposalId}`, proposal);
    finding.status = "proposed";
    finding.proposal_id = proposalId;
    await db.set(`intelligence:${finding.id}`, finding);

    if (finding.relevance_score >= 9) {
      try { await sendSystemAlert({ message: `High-relevance finding (${finding.relevance_score}/10): ${finding.title}`, severity: "INFO", source: "intelligence-update-agent" }); }
      catch {}
    }
  }
  return surfaced.length;
}

// ── Main Scan ───────────────────────────────────────────────────────────────

export async function runIntelligenceScan(trigger = "manual", sourceFilter = null) {
  const scanId = uuidv4();
  const sourcesToScan = sourceFilter
    ? SOURCES.filter(s => s.name === sourceFilter)
    : SOURCES;

  const allFindings = [];
  let sourcesFailed = 0;

  for (const source of sourcesToScan) {
    try {
      const findings = await scanSource(source);
      allFindings.push(...findings);
    } catch (e) {
      sourcesFailed++;
      console.log(`[INTEL] Source ${source.name} failed: ${e.message}`);
    }
  }

  const proposalCount = await generateProposals(allFindings);

  await db.set("intel-last-run", {
    scan_id: scanId,
    run_at: new Date().toISOString(),
    trigger,
    sources_scanned: sourcesToScan.length,
    sources_failed: sourcesFailed,
    findings_count: allFindings.length,
    surfaced_count: allFindings.filter(f => f.relevance_score >= 6).length,
    proposals_generated: proposalCount,
  });

  return {
    scan_id: scanId,
    scanned_at: new Date().toISOString(),
    findings_count: allFindings.length,
    surfaced_count: allFindings.filter(f => f.relevance_score >= 6).length,
    sources_scanned: sourcesToScan.length - sourcesFailed,
    sources_failed: sourcesFailed,
    findings: allFindings,
    summary: `Scanned ${sourcesToScan.length} sources, found ${allFindings.length} items, surfaced ${allFindings.filter(f => f.relevance_score >= 6).length} for review`,
  };
}

// ── Finding Management ──────────────────────────────────────────────────────

export async function getFindings(filters = {}) {
  const keys = await db.list("intelligence:");
  const sortedKeys = keys.sort().reverse().slice(0, 200);
  const findings = [];
  for (const key of sortedKeys) {
    const f = await db.get(key);
    if (!f) continue;
    if (filters.status && f.status !== filters.status) continue;
    if (filters.score && f.relevance_score < parseInt(filters.score)) continue;
    if (filters.category && f.category !== filters.category) continue;
    findings.push(f);
    if (findings.length >= 100) break;
  }
  findings.sort((a, b) => (b.found_at || "").localeCompare(a.found_at || ""));
  return findings.slice(0, 100);
}

export async function getFinding(id) {
  return await db.get(`intelligence:${id}`);
}

// ── Approval with Snapshot ──────────────────────────────────────────────────

export async function approveFinding(id) {
  const finding = await db.get(`intelligence:${id}`);
  if (!finding) throw new Error(`Finding ${id} not found`);

  // Create snapshot before applying
  const snapshotId = uuidv4();
  const registry = await readRegistry();
  const context = await readContext();

  const skillsDir = join(__dirname, "../skills");
  const skillFiles = {};
  try {
    for (const f of readdirSync(skillsDir).filter(f => f.endsWith(".md"))) {
      skillFiles[f] = readFileSync(join(skillsDir, f), "utf8").slice(0, 5000);
    }
  } catch {}

  await db.set(`snapshot:${snapshotId}`, {
    id: snapshotId,
    created_at: new Date().toISOString(),
    reason: `Pre-approval snapshot for finding ${finding.title}`,
    registry,
    skill_files: skillFiles,
    context,
  });

  // ACTUALLY WRITE to context — this was missing before
  if (!context.learned_patterns) context.learned_patterns = [];
  context.learned_patterns.push({
    id: uuidv4(),
    content: `[Intel ${finding.category}] ${finding.suggested_action || finding.summary}`,
    source: "intelligence-update-agent",
    finding_id: finding.id,
    finding_title: finding.title,
    relevance_score: finding.relevance_score,
    added: new Date().toISOString(),
    approved_by: "human",
  });
  context.last_updated = new Date().toISOString();
  await writeContext(context);

  // Log execution
  try {
    const { logExecution } = await import("../tools/approval-tools.js");
    await logExecution({
      source: "intelligence",
      proposal_id: finding.id,
      action_type: "context_addition",
      change_type: finding.category,
      description: `Intel finding approved: "${finding.title}" - ${finding.suggested_action || "added to context"}`,
      success: true,
    });
  } catch (e) {
    console.log("[EXEC-LOG] Failed to log intel execution:", e.message);
  }

  finding.status = "approved";
  finding.snapshot_id = snapshotId;
  await db.set(`intelligence:${finding.id}`, finding);

  return { approved: true, snapshot_id: snapshotId, finding_id: id, change_applied: finding.suggested_action, context_updated: true };
}

export async function rejectFinding(id, reason = "") {
  const finding = await db.get(`intelligence:${id}`);
  if (!finding) throw new Error(`Finding ${id} not found`);
  finding.status = "rejected";
  finding.notes = reason;
  await db.set(`intelligence:${finding.id}`, finding);
  return { rejected: true, id, reason };
}
