import * as db from "../db.js";

export async function logRequest(entry) {
  await db.set(`request:${entry.id}`, entry);
}

export async function logFeedback(requestId, outcome, feedback) {
  const entry = await db.get(`request:${requestId}`);
  if (!entry) throw new Error(`Request ${requestId} not found`);
  entry.outcome = outcome;
  entry.feedback = feedback;
  entry.feedback_timestamp = new Date().toISOString();
  await db.set(`request:${requestId}`, entry);
}

export async function readRecentLog(n = 50) {
  const keys = await db.list("request:");
  const entries = [];
  for (const key of keys) {
    const entry = await db.get(key);
    if (entry) entries.push(entry);
  }
  entries.sort((a, b) => {
    const ta = a.timestamp || "";
    const tb = b.timestamp || "";
    return tb.localeCompare(ta);
  });
  return entries.slice(0, n);
}
