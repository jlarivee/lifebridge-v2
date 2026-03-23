/**
 * LifeBridge Connectors Agent
 * Gmail + Slack via MCP servers. Approval gate on sends. Full logging.
 */

import Anthropic from "@anthropic-ai/sdk";
import { v4 as uuidv4 } from "uuid";
import * as db from "../db.js";

const client = new Anthropic();

const MCP_GMAIL = { type: "url", url: "https://gmail.mcp.claude.com/mcp", name: "gmail-mcp" };
const MCP_SLACK = { type: "url", url: "https://mcp.slack.com/mcp", name: "slack-mcp" };

const DEFAULT_CONFIG = {
  gmail: { approved_recipients: [], default_from_name: "LifeBridge", log_sends: true },
  slack: { default_alert_channel: "#lifebridge-alerts", default_briefing_channel: "#lifebridge-briefings", log_sends: true },
};

// ── Config ──────────────────────────────────────────────────────────────────

export async function getConfig() {
  return await db.get("connector-config") || DEFAULT_CONFIG;
}

export async function updateConfig(partial) {
  const config = await getConfig();
  if (partial.gmail) Object.assign(config.gmail, partial.gmail);
  if (partial.slack) Object.assign(config.slack, partial.slack);
  await db.set("connector-config", config);
  return config;
}

// ── Health Checks ───────────────────────────────────────────────────────────

async function checkGmail() {
  const start = Date.now();
  try {
    const resp = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      mcp_servers: [MCP_GMAIL],
      messages: [{ role: "user", content: "List the 1 most recent email subject line. Return ONLY the subject line text, nothing else." }],
    });
    return { connected: true, status: "ok", latency_ms: Date.now() - start, last_checked: new Date().toISOString() };
  } catch (e) {
    return { connected: false, status: "error", error: e.message, latency_ms: Date.now() - start, last_checked: new Date().toISOString() };
  }
}

async function checkSlack() {
  const start = Date.now();
  try {
    const resp = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 100,
      mcp_servers: [MCP_SLACK],
      messages: [{ role: "user", content: "List 1 recent Slack channel name. Return ONLY the channel name, nothing else." }],
    });
    return { connected: true, status: "ok", latency_ms: Date.now() - start, last_checked: new Date().toISOString() };
  } catch (e) {
    return { connected: false, status: "error", error: e.message, latency_ms: Date.now() - start, last_checked: new Date().toISOString() };
  }
}

export async function getStatus() {
  // Return cached status if checked within last 5 minutes
  const cached = await db.get("connector-status");
  if (cached && cached.checked_at && Date.now() - new Date(cached.checked_at).getTime() < 300000) {
    return cached;
  }

  const [gmail, slack] = await Promise.all([checkGmail(), checkSlack()]);
  const status = { gmail, slack, checked_at: new Date().toISOString() };
  await db.set("connector-status", status);
  return status;
}

export async function testConnector(connector) {
  if (connector === "gmail") return { success: true, connector: "gmail", ...(await checkGmail()) };
  if (connector === "slack") return { success: true, connector: "slack", ...(await checkSlack()) };
  return { success: false, connector, error: "Unknown connector" };
}

// ── Send Logging ────────────────────────────────────────────────────────────

async function logSend(entry) {
  await db.set(`connector-send:${entry.id}`, entry);
  return entry;
}

export async function getSendLog(limit = 50) {
  const keys = await db.list("connector-send:");
  const entries = [];
  for (const key of keys) {
    const e = await db.get(key);
    if (e) entries.push(e);
  }
  entries.sort((a, b) => (b.sent_at || "").localeCompare(a.sent_at || ""));
  return entries.slice(0, limit);
}

// ── Gmail Send ──────────────────────────────────────────────────────────────

export async function sendGmail({ to, subject, body, cc, require_approval = true }) {
  const id = uuidv4();
  const entry = {
    id, sent_at: new Date().toISOString(), connector: "gmail",
    operation: "send", recipient_or_channel: to, subject,
    message_preview: (body || "").slice(0, 100),
    status: require_approval ? "pending_approval" : "sending",
    approved_by: require_approval ? null : "system", error: null,
  };

  if (require_approval) {
    entry.pending_payload = { to, subject, body, cc };
    await logSend(entry);
    return { success: true, connector: "gmail", pending: true, approval_id: id, message_id: null };
  }

  try {
    const prompt = cc
      ? `Send an email to ${to} (cc: ${cc}) with subject "${subject}" and body: ${body}`
      : `Send an email to ${to} with subject "${subject}" and body: ${body}`;

    const resp = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      mcp_servers: [MCP_GMAIL],
      messages: [{ role: "user", content: prompt }],
    });

    const output = resp.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    entry.status = "sent";
    entry.message_id = id;
    await logSend(entry);
    return { success: true, connector: "gmail", message_id: id, pending: false };
  } catch (e) {
    entry.status = "failed";
    entry.error = e.message;
    await logSend(entry);
    return { success: false, connector: "gmail", error: e.message, message_id: null };
  }
}

// ── Gmail Read ──────────────────────────────────────────────────────────────

export async function readGmail({ count = 10, from, subject: subjectFilter } = {}) {
  try {
    let prompt = `List the ${count} most recent emails.`;
    if (from) prompt += ` Filter to emails from: ${from}.`;
    if (subjectFilter) prompt += ` Filter to subjects containing: ${subjectFilter}.`;
    prompt += ` For each email return: from, subject, date, preview of body (first 50 chars). Return as JSON array.`;

    const resp = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      mcp_servers: [MCP_GMAIL],
      messages: [{ role: "user", content: prompt }],
    });

    const text = resp.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    let emails = [];
    try {
      const start = text.indexOf("[");
      const end = text.lastIndexOf("]") + 1;
      if (start >= 0 && end > start) emails = JSON.parse(text.slice(start, end));
    } catch {}

    return { success: true, emails, count: emails.length };
  } catch (e) {
    return { success: false, emails: [], count: 0, error: e.message };
  }
}

// ── Slack Send ──────────────────────────────────────────────────────────────

export async function sendSlack({ channel, message, thread_ts, require_approval = true }) {
  const config = await getConfig();
  const targetChannel = channel || config.slack.default_alert_channel;
  const id = uuidv4();

  const entry = {
    id, sent_at: new Date().toISOString(), connector: "slack",
    operation: "send", recipient_or_channel: targetChannel,
    subject: null, message_preview: (message || "").slice(0, 100),
    status: require_approval ? "pending_approval" : "sending",
    approved_by: require_approval ? null : "system", error: null,
  };

  if (require_approval) {
    entry.pending_payload = { channel: targetChannel, message, thread_ts };
    await logSend(entry);
    return { success: true, connector: "slack", pending: true, approval_id: id, timestamp: null };
  }

  try {
    let prompt = `Send a message to Slack channel ${targetChannel}: ${message}`;
    if (thread_ts) prompt += ` (in thread: ${thread_ts})`;

    const resp = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 200,
      mcp_servers: [MCP_SLACK],
      messages: [{ role: "user", content: prompt }],
    });

    entry.status = "sent";
    entry.timestamp = new Date().toISOString();
    await logSend(entry);
    return { success: true, connector: "slack", timestamp: entry.timestamp, pending: false };
  } catch (e) {
    entry.status = "failed";
    entry.error = e.message;
    await logSend(entry);
    return { success: false, connector: "slack", error: e.message, timestamp: null };
  }
}

// ── Approval Gate ───────────────────────────────────────────────────────────

export async function approveSend(approvalId) {
  const entry = await db.get(`connector-send:${approvalId}`);
  if (!entry) throw new Error(`Send operation ${approvalId} not found`);
  if (entry.status !== "pending_approval") throw new Error(`Already ${entry.status}`);

  const payload = entry.pending_payload;
  if (!payload) throw new Error("No pending payload found");

  let result;
  if (entry.connector === "gmail") {
    result = await sendGmail({ ...payload, require_approval: false });
  } else if (entry.connector === "slack") {
    result = await sendSlack({ ...payload, require_approval: false });
  } else {
    throw new Error(`Unknown connector: ${entry.connector}`);
  }

  entry.status = "sent";
  entry.approved_by = "user";
  delete entry.pending_payload;
  await db.set(`connector-send:${approvalId}`, entry);

  return { sent: true, connector: entry.connector, message_id: result.message_id || result.timestamp };
}

// ── System Alert Helper ─────────────────────────────────────────────────────

export async function sendSystemAlert({ message, severity = "INFO", source = "system", channel }) {
  const config = await getConfig();
  const targetChannel = channel || config.slack.default_alert_channel;
  const formatted = `[${severity.toUpperCase()}] ${source}: ${message}`;

  try {
    return await sendSlack({ channel: targetChannel, message: formatted, require_approval: false });
  } catch (e) {
    console.log(`[ALERT] Failed to send system alert: ${e.message}`);
    console.log(`[ALERT] ${formatted}`);
    return { success: false, error: e.message };
  }
}
