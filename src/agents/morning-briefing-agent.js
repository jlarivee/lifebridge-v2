/**
 * LifeBridge Morning Briefing Agent
 * Compiles daily briefing from all systems, delivers via Gmail + Slack.
 */

import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import * as db from "../db.js";
import { sendGmail, sendSlack } from "./connectors.js";
import { getDashboardUrl, getBaseUrl } from "../tools/safe-config.js";

const BASE = getBaseUrl();
const DASHBOARD_URL = getDashboardUrl();
const client = new Anthropic();

// ── Weather ─────────────────────────────────────────────────────────────────

async function fetchWeather() {
  try {
    const resp = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 150,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
      messages: [{
        role: "user",
        content: "What is today's weather forecast for Canton Valley, CT (or nearby Canton, CT)? Reply in one concise sentence with current conditions, high/low temps in Fahrenheit, and precipitation chance.",
      }],
    });
    const text = resp.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    return text || "Weather data unavailable.";
  } catch (e) {
    return `Weather unavailable: ${e.message}`;
  }
}

// ── Data Fetchers ───────────────────────────────────────────────────────────

async function fetchJSON(path) {
  const resp = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function fetchHealth() {
  try {
    const data = await fetchJSON("/integrity/reports/latest");
    if (data.status === "no reports yet") return "No integrity scans run yet.";
    const icon = data.status === "healthy" ? "🟢" : data.status === "degraded" ? "🟡" : "🔴";
    let text = `${icon} ${data.status.toUpperCase()} — ${data.agents_checked} agents checked, ${data.agents_healthy} healthy`;
    if (data.issues?.length > 0) {
      text += `\n   Issues: ${data.issues.map(i => `${i.agent_name}: ${i.type}`).join(", ")}`;
    }
    return text;
  } catch (e) { return `Data unavailable — integrity reports returned error: ${e.message}`; }
}

async function fetchTests() {
  try {
    const resp = await fetch(`${BASE}/test/runs`, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const runs = await resp.json();
    const cutoff = new Date(Date.now() - 86400000).toISOString();
    const recent = (Array.isArray(runs) ? runs : []).filter(r => r.run_at >= cutoff).slice(0, 50);
    if (recent.length === 0) return "No test runs in the last 24 hours.";
    const passed = recent.filter(r => r.status === "pass").length;
    const failed = recent.filter(r => r.status === "fail").length;
    const errors = recent.filter(r => r.status === "error").length;
    let text = `${recent.length} runs — ${passed} passed, ${failed} failed, ${errors} errors`;
    if (failed > 0) {
      const failures = recent.filter(r => r.status === "fail");
      const byAgent = {};
      failures.forEach(f => { byAgent[f.agent_name] = (byAgent[f.agent_name] || 0) + 1; });
      text += `\n   Failures: ${Object.entries(byAgent).map(([a, c]) => `${a} (${c})`).join(", ")}`;
    }
    return text;
  } catch (e) {
    if (e.name === "AbortError" || e.name === "TimeoutError") return "Test data unavailable — run manually at /test/runs";
    return `Data unavailable — test runs returned error: ${e.message}`;
  }
}

async function fetchIntelligence() {
  try {
    const findings = await fetchJSON("/intelligence/findings?score=8");
    const cutoff = new Date(Date.now() - 86400000).toISOString();
    const recent = findings.filter(f => f.found_at >= cutoff);
    if (recent.length === 0) return "No high-relevance findings in the last 24 hours.";
    let text = `${recent.length} new finding(s) scored 8+`;
    const top3 = recent.slice(0, 3);
    for (const f of top3) {
      text += `\n   • [${f.relevance_score}/10] ${f.title} (${f.source})`;
      if (f.suggested_action) text += `\n     → ${f.suggested_action}`;
    }
    return text;
  } catch (e) { return `Data unavailable — intelligence returned error: ${e.message}`; }
}

async function fetchProposals() {
  try {
    const findings = await fetchJSON("/intelligence/findings?status=proposed");
    if (findings.length === 0) return "No proposals pending review.";
    let text = `${findings.length} proposal(s) awaiting review`;
    const top3 = findings.slice(0, 3);
    for (const f of top3) {
      text += `\n   • [${f.relevance_score}/10] ${f.title}`;
    }
    text += `\n   Review at: ${DASHBOARD_URL}`;
    return text;
  } catch (e) { return `Data unavailable — proposals returned error: ${e.message}`; }
}

async function fetchIdeas() {
  try {
    const ideas = await fetchJSON("/ideas");
    const saved = ideas.filter(i => i.status === "saved");
    if (saved.length === 0) return "No unsent ideas queued.";
    let text = `${saved.length} idea(s) saved but not yet sent`;
    for (const i of saved.slice(0, 5)) {
      text += `\n   • ${i.text.slice(0, 80)}${i.text.length > 80 ? "..." : ""}`;
    }
    return text;
  } catch (e) { return `Data unavailable — ideas returned error: ${e.message}`; }
}

async function fetchSlab() {
  try {
    const resp = await fetch(`${BASE}/agents/slab-inventory-tracker-agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request: "give me aging report and inventory summary", context: {} }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await resp.json();
    return data.output || data.result || "No slab data available.";
  } catch (e) { return `Data unavailable — slab tracker returned error: ${e.message}`; }
}

// ── Briefing Compilation ────────────────────────────────────────────────────

export async function compileBriefing() {
  const [weather, health, tests, intel, proposals, ideas, slab] = await Promise.allSettled([
    fetchWeather(), fetchHealth(), fetchTests(), fetchIntelligence(),
    fetchProposals(), fetchIdeas(), fetchSlab(),
  ]);

  const sections = {
    weather: weather.status === "fulfilled" ? weather.value : "Weather unavailable.",
    health: health.status === "fulfilled" ? health.value : `Data unavailable: ${health.reason}`,
    tests: tests.status === "fulfilled" ? tests.value : `Data unavailable: ${tests.reason}`,
    intelligence: intel.status === "fulfilled" ? intel.value : `Data unavailable: ${intel.reason}`,
    proposals: proposals.status === "fulfilled" ? proposals.value : `Data unavailable: ${proposals.reason}`,
    ideas: ideas.status === "fulfilled" ? ideas.value : `Data unavailable: ${ideas.reason}`,
    slab: slab.status === "fulfilled" ? slab.value : `Data unavailable: ${slab.reason}`,
    focus: "",
  };

  // Generate daily focus
  try {
    const resp = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `Based on this LifeBridge system data, write 2-3 sentences identifying today's top priority for Josh Larivee. Be specific and actionable.\n\nHealth: ${sections.health}\nTests: ${sections.tests}\nIntel: ${sections.intelligence}\nProposals: ${sections.proposals}\nIdeas: ${sections.ideas}\nSlab: ${sections.slab}`,
      }],
    });
    sections.focus = resp.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
  } catch {
    sections.focus = "Focus generation unavailable.";
  }

  return sections;
}

function formatBriefing(sections) {
  const now = new Date();
  const day = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const time = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

  return `═══════════════════════════════════════
LIFEBRIDGE — ${day.toUpperCase()} ${time} UTC
═══════════════════════════════════════

🌤️ WEATHER — CANTON VALLEY, CT
${sections.weather}

🟢 SYSTEM HEALTH
${sections.health}

📊 TEST RESULTS (last 24h)
${sections.tests}

🔍 INTELLIGENCE (new since yesterday)
${sections.intelligence}

📋 PROPOSALS PENDING
${sections.proposals}

💡 IDEAS QUEUED
${sections.ideas}

🪵 THREE RIVERS SLAB
${sections.slab}

🎯 TODAY'S FOCUS
${sections.focus}

─────────────────────────────────────
View full dashboard: ${DASHBOARD_URL}
═══════════════════════════════════════`;
}

function formatSlack(sections) {
  return `*LIFEBRIDGE DAILY BRIEFING*\n\n` +
    `*🌤️ Weather — Canton Valley, CT*\n${sections.weather}\n\n` +
    `*🟢 System Health*\n${sections.health}\n\n` +
    `*📊 Tests*\n${sections.tests}\n\n` +
    `*🔍 Intelligence*\n${sections.intelligence}\n\n` +
    `*📋 Proposals*\n${sections.proposals}\n\n` +
    `*💡 Ideas*\n${sections.ideas}\n\n` +
    `*🪵 Slab*\n${typeof sections.slab === "string" ? sections.slab.slice(0, 300) : "No data"}\n\n` +
    `*🎯 Focus*\n${sections.focus}`;
}

// ── Delivery ────────────────────────────────────────────────────────────────

export async function deliverBriefing(sections) {
  const formatted = formatBriefing(sections);
  const slackMsg = formatSlack(sections);
  const now = new Date();
  const subject = `LifeBridge Daily Briefing — ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}`;

  const deliveredVia = [];
  let gmailId = null;
  let slackTs = null;

  // Gmail
  try {
    const result = await sendGmail({ to: "jlarivee@gmail.com", subject, body: formatted, require_approval: false });
    if (result.success || result.message_id) { deliveredVia.push("gmail"); gmailId = result.message_id; }
  } catch (e) { console.log(`[BRIEFING] Gmail delivery failed: ${e.message}`); }

  // Slack
  try {
    const result = await sendSlack({ channel: "#lifebridge-briefings", message: slackMsg, require_approval: false });
    if (result.success || result.timestamp) { deliveredVia.push("slack"); slackTs = result.timestamp; }
  } catch (e) { console.log(`[BRIEFING] Slack delivery failed: ${e.message}`); }

  return { delivered_via: deliveredVia, gmail_message_id: gmailId, slack_timestamp: slackTs, formatted };
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function runBriefing() {
  const sections = await compileBriefing();
  const delivery = await deliverBriefing(sections);

  const briefing = {
    id: uuidv4(),
    date: new Date().toISOString().slice(0, 10),
    compiled_at: new Date().toISOString(),
    delivered_at: new Date().toISOString(),
    delivered_via: delivery.delivered_via,
    sections,
    gmail_message_id: delivery.gmail_message_id,
    slack_timestamp: delivery.slack_timestamp,
    status: delivery.delivered_via.length > 0 ? "delivered" : "failed",
  };

  await db.set(`briefing:${briefing.id}`, briefing);
  await db.set("briefing-last-delivered", { at: briefing.delivered_at, id: briefing.id });

  return {
    agent: "morning-briefing-agent",
    output: delivery.formatted,
    success: true,
    briefing_id: briefing.id,
    sections_compiled: Object.keys(sections).length,
    delivered_via: delivery.delivered_via,
    delivered_at: briefing.delivered_at,
  };
}

export async function previewBriefing() {
  const sections = await compileBriefing();
  return {
    agent: "morning-briefing-agent",
    output: formatBriefing(sections),
    success: true,
    preview: true,
    sections,
  };
}

export async function getLatestBriefing() {
  const last = await db.get("briefing-last-delivered");
  if (!last?.id) {
    return { agent: "morning-briefing-agent", output: "No briefings delivered yet.", success: true };
  }
  const briefing = await db.get(`briefing:${last.id}`);
  if (!briefing) {
    return { agent: "morning-briefing-agent", output: "Briefing record not found.", success: true };
  }
  return { agent: "morning-briefing-agent", output: formatBriefing(briefing.sections), success: true, briefing };
}

export async function getBriefingHistory(limit = 30) {
  const keys = await db.list("briefing:");
  const briefings = [];
  for (const key of keys) {
    if (key === "briefing-last-delivered") continue;
    const b = await db.get(key);
    if (b) briefings.push({ briefing_id: b.id, date: b.date, delivered_via: b.delivered_via, status: b.status, summary: `${b.sections?.focus?.slice(0, 100) || "No focus"}` });
  }
  briefings.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return briefings.slice(0, limit);
}
