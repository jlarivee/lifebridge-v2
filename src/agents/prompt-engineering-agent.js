/**
 * LifeBridge Prompt Engineering Agent
 * Interactive Claude-powered dashboard for building high-quality prompts
 * using Anthropic best practices.
 *
 * Sessions are ephemeral (in-memory Map). Saved prompts persist in Replit DB.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { v4 as uuidv4 } from "uuid";
import * as db from "../db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const skill = readFileSync(
  join(__dirname, "../skills/prompt-engineering-agent.md"),
  "utf8"
);

const client = new Anthropic();

export const AGENT_META = {
  name: "prompt-engineering-agent",
  domain: "System",
  purpose: "Interactive session-based agent for building high-quality prompts using Anthropic best practices",
  status: "Active",
  trigger_patterns: ["prompt", "build a prompt", "prompt engineering", "write a prompt", "improve a prompt"],
  endpoints: [
    "/api/prompt-engineering/session/start",
    "/api/prompt-engineering/session/message",
    "/api/prompt-engineering/session/generate",
    "/api/prompt-engineering/prompts",
    "/api/prompt-engineering/prompts/:id",
  ],
  requires_approval: [],
};

// ── In-memory session store ──────────────────────────────────────────────────

const sessions = new Map();

// ── Score parsing ────────────────────────────────────────────────────────────

function parseScore(text) {
  const match = text.match(/\[SCORE:\s*(\{[^}]+\})\s*\]/);
  if (!match) return null;
  try {
    const dims = JSON.parse(match[1]);
    const total = (dims.purpose || 0) + (dims.audience || 0) + (dims.format || 0) +
      (dims.constraints || 0) + (dims.examples || 0);
    return { dimensions: dims, total };
  } catch {
    return null;
  }
}

function parseGeneratedPrompt(text) {
  const match = text.match(/\[PROMPT_START\]([\s\S]*?)\[PROMPT_END\]/);
  return match ? match[1].trim() : null;
}

function stripTags(text) {
  return text
    .replace(/\[SCORE:\s*\{[^}]+\}\s*\]/g, "")
    .replace(/\[PROMPT_START\]/g, "")
    .replace(/\[PROMPT_END\]/g, "")
    .trim();
}

// ── Claude API call ──────────────────────────────────────────────────────────

async function callClaude(conversation) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: skill,
    messages: conversation.map(m => ({ role: m.role, content: m.content })),
  });

  const raw = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();

  const scoreResult = parseScore(raw);
  const generatedPrompt = parseGeneratedPrompt(raw);
  const displayText = stripTags(raw);

  return {
    raw,
    displayText,
    score: scoreResult?.total ?? 0,
    scoreDimensions: scoreResult?.dimensions ?? { purpose: 0, audience: 0, format: 0, constraints: 0, examples: 0 },
    generatedPrompt,
    readyToGenerate: !!(generatedPrompt) || (scoreResult?.total ?? 0) >= 80,
  };
}

// ── Session start ────────────────────────────────────────────────────────────

export async function startSession(topic) {
  const sessionId = uuidv4();

  const conversation = [{ role: "user", content: topic }];

  const result = await callClaude(conversation);
  conversation.push({ role: "assistant", content: result.raw });

  sessions.set(sessionId, {
    sessionId,
    topic,
    conversation,
    score: result.score,
    scoreDimensions: result.scoreDimensions,
    generatedPrompt: result.generatedPrompt,
    createdAt: new Date().toISOString(),
  });

  return {
    sessionId,
    score: result.score,
    scoreDimensions: result.scoreDimensions,
    message: result.displayText,
    readyToGenerate: result.readyToGenerate,
    generatedPrompt: result.generatedPrompt,
    conversationHistory: conversation.map(m => ({
      role: m.role,
      content: m.role === "assistant" ? stripTags(m.content) : m.content,
    })),
  };
}

// ── Session message ──────────────────────────────────────────────────────────

export async function sessionMessage(sessionId, message) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session not found or expired");

  session.conversation.push({ role: "user", content: message });

  const result = await callClaude(session.conversation);
  session.conversation.push({ role: "assistant", content: result.raw });

  session.score = result.score;
  session.scoreDimensions = result.scoreDimensions;
  if (result.generatedPrompt) session.generatedPrompt = result.generatedPrompt;

  return {
    sessionId,
    score: result.score,
    scoreDimensions: result.scoreDimensions,
    message: result.displayText,
    readyToGenerate: result.readyToGenerate,
    generatedPrompt: result.generatedPrompt,
    conversationHistory: session.conversation.map(m => ({
      role: m.role,
      content: m.role === "assistant" ? stripTags(m.content) : m.content,
    })),
  };
}

// ── Force generate ───────────────────────────────────────────────────────────

export async function generatePrompt(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session not found or expired");

  session.conversation.push({
    role: "user",
    content: "Generate the prompt now based on everything we've discussed.",
  });

  const result = await callClaude(session.conversation);
  session.conversation.push({ role: "assistant", content: result.raw });

  session.score = result.score;
  session.scoreDimensions = result.scoreDimensions;
  if (result.generatedPrompt) session.generatedPrompt = result.generatedPrompt;

  return {
    sessionId,
    score: result.score,
    scoreDimensions: result.scoreDimensions,
    generatedPrompt: result.generatedPrompt || result.displayText,
    message: result.displayText,
  };
}

// ── Save prompt ──────────────────────────────────────────────────────────────

export async function savePrompt(sessionId, title, tags) {
  const session = sessions.get(sessionId);
  if (!session) throw new Error("Session not found or expired");
  if (!session.generatedPrompt) throw new Error("No generated prompt to save");

  const id = uuidv4();
  const autoTitle = title ||
    session.topic.slice(0, 60) + (session.topic.length > 60 ? "..." : "");

  const record = {
    id,
    title: autoTitle,
    topic: session.topic,
    conversation: session.conversation.map(m => ({
      role: m.role,
      content: m.role === "assistant" ? stripTags(m.content) : m.content,
    })),
    finalPrompt: session.generatedPrompt,
    score: session.score,
    scoreDimensions: session.scoreDimensions,
    tags: tags || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await db.set(`prompt:${id}`, record);
  return { id, prompt: record };
}

// ── List prompts ─────────────────────────────────────────────────────────────

export async function listPrompts() {
  const keys = await db.list("prompt:");
  const prompts = [];
  for (const key of keys) {
    const p = await db.get(key);
    if (p) prompts.push(p);
  }
  prompts.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return prompts;
}

// ── Get prompt ───────────────────────────────────────────────────────────────

export async function getPrompt(id) {
  const p = await db.get(`prompt:${id}`);
  if (!p) throw new Error("Prompt not found");
  return p;
}

// ── Update prompt ─────────────────────────────────────────────────────────────

export async function updatePrompt(id, updates) {
  const p = await db.get(`prompt:${id}`);
  if (!p) throw new Error("Prompt not found");

  const updated = {
    ...p,
    ...(updates.title !== undefined && { title: updates.title }),
    ...(updates.finalPrompt !== undefined && { finalPrompt: updates.finalPrompt }),
    ...(updates.tags !== undefined && { tags: updates.tags }),
    updatedAt: new Date().toISOString(),
  };

  await db.set(`prompt:${id}`, updated);
  return updated;
}

// ── Delete prompt ─────────────────────────────────────────────────────────────

export async function deletePrompt(id) {
  await db.set(`prompt:${id}`, null);
  return { success: true };
}
