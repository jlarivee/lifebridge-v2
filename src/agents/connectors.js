/**
 * LifeBridge Connectors Agent
 * Gmail via SMTP (nodemailer), Slack via Webhook.
 * Approval gate on sends. Full logging.
 *
 * Secrets needed in Replit:
 *   GMAIL_USER — sender email address
 *   GMAIL_APP_PASSWORD — Google App Password (16 chars, no spaces)
 *   SLACK_WEBHOOK_URL — Slack incoming webhook URL
 */

import { v4 as uuidv4 } from "uuid";
import * as db from "../db.js";

const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || "";
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";

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
  const configured = !!(GMAIL_USER && GMAIL_APP_PASSWORD);
  if (!configured) {
    return { connected: false, status: "not_configured", error: "GMAIL_USER or GMAIL_APP_PASSWORD not set", latency_ms: 0, last_checked: new Date().toISOString() };
  }
  // Verify SMTP connection
  try {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.default.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
    await transport.verify();
    transport.close();
    return { connected: true, status: "ok", latency_ms: Date.now() - start, last_checked: new Date().toISOString() };
  } catch (e) {
    return { connected: false, status: "error", error: e.message, latency_ms: Date.now() - start, last_checked: new Date().toISOString() };
  }
}

async function checkSlack() {
  const start = Date.now();
  if (!SLACK_WEBHOOK_URL) {
    return { connected: false, status: "not_configured", error: "SLACK_WEBHOOK_URL not set", latency_ms: 0, last_checked: new Date().toISOString() };
  }
  // Ping the webhook with a dry-run (Slack webhooks don't have a test mode,
  // but a GET returns method_not_allowed which confirms the URL is live)
  try {
    const resp = await fetch(SLACK_WEBHOOK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "" }), signal: AbortSignal.timeout(10000) });
    // Slack returns 200 even for empty text, or 400 "no_text" — both mean it's connected
    const ok = resp.status === 200 || resp.status === 400;
    return { connected: ok, status: ok ? "ok" : "error", latency_ms: Date.now() - start, last_checked: new Date().toISOString() };
  } catch (e) {
    return { connected: false, status: "error", error: e.message, latency_ms: Date.now() - start, last_checked: new Date().toISOString() };
  }
}

export async function getStatus() {
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

  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    entry.status = "failed";
    entry.error = "Gmail not configured";
    await logSend(entry);
    return { success: false, connector: "gmail", error: "GMAIL_USER or GMAIL_APP_PASSWORD not set", message_id: null };
  }

  try {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.default.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });

    const config = await getConfig();
    const mailOpts = {
      from: `${config.gmail.default_from_name} <${GMAIL_USER}>`,
      to,
      subject,
      text: body,
    };
    if (cc) mailOpts.cc = cc;

    const info = await transport.sendMail(mailOpts);
    transport.close();

    entry.status = "sent";
    entry.message_id = info.messageId;
    await logSend(entry);
    return { success: true, connector: "gmail", message_id: info.messageId, pending: false };
  } catch (e) {
    entry.status = "failed";
    entry.error = e.message;
    await logSend(entry);
    return { success: false, connector: "gmail", error: e.message, message_id: null };
  }
}

// ── Gmail Read (stub — requires Google API OAuth, not available via SMTP) ───

export async function readGmail({ count = 10, from, subject: subjectFilter } = {}) {
  return {
    success: false,
    emails: [],
    count: 0,
    error: "Gmail read requires Google API OAuth — not yet implemented. Use Gmail MCP in Claude Desktop for now.",
  };
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

  if (!SLACK_WEBHOOK_URL) {
    entry.status = "failed";
    entry.error = "Slack not configured";
    await logSend(entry);
    return { success: false, connector: "slack", error: "SLACK_WEBHOOK_URL not set", timestamp: null };
  }

  try {
    const resp = await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message, channel: targetChannel }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Slack API ${resp.status}: ${errText}`);
    }

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
