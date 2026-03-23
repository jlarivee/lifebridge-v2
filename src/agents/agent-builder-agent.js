import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { v4 as uuidv4 } from "uuid";
import * as db from "../db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(
  join(__dirname, "../skills/agent-builder-agent.md"),
  "utf8"
);
const skillTemplate = readFileSync(
  join(__dirname, "../skills/agent-builder-templates/skill-template.md"),
  "utf8"
);
const codeTemplate = readFileSync(
  join(__dirname, "../skills/agent-builder-templates/code-template.js"),
  "utf8"
);

const client = new Anthropic();

function buildSystemPrompt(buildBrief, context) {
  return `${skill}

Here is the skill template you must use — fill in the [BRACKETED] fields:
\`\`\`
${skillTemplate}
\`\`\`

Here is the code template you must use — fill in the [BRACKETED] fields:
\`\`\`
${codeTemplate}
\`\`\`

Build brief received:
${JSON.stringify(buildBrief, null, 2)}

Context:
${JSON.stringify(context, null, 2)}`;
}

/**
 * Start a new build session — Phase 1.
 * Returns a session_id the caller uses to continue the pipeline.
 */
export async function startBuild(buildBrief, context = {}) {
  const sessionId = uuidv4();
  const systemPrompt = buildSystemPrompt(buildBrief, context);

  const userMessage = `Execute the 4-phase Agent Builder pipeline for this build brief.
Start with Phase 1 — write the skill file and output it for review.
Label your output clearly: SKILL FILE — READY FOR REVIEW
Do NOT proceed to Phase 2 until you receive explicit approval.`;

  const messages = [{ role: "user", content: userMessage }];

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: systemPrompt,
    messages,
  });

  const output = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();

  // Store session: system prompt + full message history
  const session = {
    id: sessionId,
    build_brief: buildBrief,
    context,
    system_prompt: systemPrompt,
    messages: [
      ...messages,
      { role: "assistant", content: output },
    ],
    phase: detectPhase(output),
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  await db.set(`build-session:${sessionId}`, session);

  return {
    agent: "agent-builder-agent",
    session_id: sessionId,
    phase: session.phase,
    output,
    requires_approval: true,
    approval_reason: "Review the skill file before proceeding to Phase 2",
  };
}

/**
 * Continue an existing build session — send an approval or instruction,
 * get the next phase output.
 */
export async function continueBuild(sessionId, userMessage) {
  const session = await db.get(`build-session:${sessionId}`);
  if (!session) {
    throw new Error(`Build session ${sessionId} not found`);
  }

  // Append the user's approval/instruction
  session.messages.push({ role: "user", content: userMessage });

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: session.system_prompt,
    messages: session.messages,
  });

  const output = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();

  // Append assistant response to history
  session.messages.push({ role: "assistant", content: output });
  session.phase = detectPhase(output);
  session.updated = new Date().toISOString();

  await db.set(`build-session:${sessionId}`, session);

  // Determine what approval is needed next
  let approvalReason = null;
  if (session.phase === "phase-1-review") {
    approvalReason = "Review the skill file before proceeding to Phase 2";
  } else if (session.phase === "phase-2-review") {
    approvalReason = "Review the agent code before proceeding to validation";
  } else if (session.phase === "validated") {
    approvalReason = "Validation passed — approve to deploy the agent";
  }

  return {
    agent: "agent-builder-agent",
    session_id: sessionId,
    phase: session.phase,
    output,
    requires_approval: session.phase !== "deployed" && session.phase !== "validation-failed",
    approval_reason: approvalReason,
  };
}

/**
 * Legacy single-call entry point — starts a new build.
 * Kept for backward compatibility with POST /agents/builder.
 */
export async function runAgentBuilder(buildBrief, context = {}) {
  return startBuild(buildBrief, context);
}

function detectPhase(output) {
  if (output.includes("DEPLOYMENT COMPLETE")) return "deployed";
  if (output.includes("VALIDATION PASSED")) return "validated";
  if (output.includes("VALIDATION FAILED")) return "validation-failed";
  if (output.includes("AGENT CODE — READY FOR REVIEW")) return "phase-2-review";
  if (output.includes("SKILL FILE — READY FOR REVIEW")) return "phase-1-review";
  return "in-progress";
}
