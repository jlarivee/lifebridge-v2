import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { v4 as uuidv4 } from "uuid";
import * as db from "../db.js";
import { deployAgent } from "../tools/deploy-tools.js";

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

  // ── ACTUAL DEPLOYMENT: when builder says "DEPLOYMENT COMPLETE", write files ──
  if (session.phase === "deployed") {
    try {
      const extracted = extractArtifacts(session.messages);
      if (extracted.agentName && extracted.skillContent && extracted.codeContent) {
        const registryEntry = {
          name: extracted.agentName,
          domain: extracted.domain || "General",
          status: "Active",
          purpose: `Auto-built agent: ${extracted.agentName}`,
          endpoints: [`/agents/${extracted.agentName}`],
          created_at: new Date().toISOString(),
        };

        const deployResult = await deployAgent(
          extracted.agentName,
          extracted.skillContent,
          extracted.codeContent,
          registryEntry
        );

        session.deploy_result = deployResult;
        console.log(`[BUILDER] DEPLOYED: ${extracted.agentName} — files written, registered, GitHub synced`);

        // Hot-reload: notify the system
        try {
          const PORT = process.env.PORT || 5000;
          await fetch(`http://localhost:${PORT}/system/agent-loaded`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agent: extracted.agentName }),
          });
        } catch {}

        // Log execution
        try {
          const { logExecution } = await import("../tools/approval-tools.js");
          await logExecution({
            source: "agent-builder",
            proposal_id: sessionId,
            action_type: "agent_deployed",
            change_type: "new_agent",
            description: `Deployed new agent: ${extracted.agentName} — skill + code written, registered, route live`,
            success: true,
          });
        } catch {}
      } else {
        console.log(`[BUILDER] WARNING: Could not extract artifacts from session. Agent name: ${extracted.agentName}, skill: ${!!extracted.skillContent}, code: ${!!extracted.codeContent}`);
        session.deploy_result = { deployed: false, reason: "Could not extract skill/code from conversation" };
      }
    } catch (e) {
      console.log(`[BUILDER] DEPLOY ERROR: ${e.message}`);
      session.deploy_result = { deployed: false, error: e.message };
    }
  }

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
    deploy_result: session.deploy_result || null,
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

/**
 * Extract skill file content, code content, and agent name from the build conversation.
 * Scans all assistant messages for markdown/code fenced blocks.
 */
function extractArtifacts(messages) {
  let skillContent = null;
  let codeContent = null;
  let agentName = null;
  let domain = null;

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const text = typeof msg.content === "string" ? msg.content : "";

    // Extract agent name from various patterns
    if (!agentName) {
      const nameMatch = text.match(/Agent:\s+([\w-]+)/i) ||
        text.match(/agent_name.*?["']?([\w-]+(?:-agent)?)["']?/i) ||
        text.match(/Code file:\s+src\/agents\/([\w-]+)\.js/i) ||
        text.match(/Route:\s+POST \/agents\/([\w-]+)/i);
      if (nameMatch) agentName = nameMatch[1];
    }

    // Extract domain
    if (!domain) {
      const domainMatch = text.match(/Domain[:\s]+(\w[\w\s]*\w)/i);
      if (domainMatch) domain = domainMatch[1].trim();
    }

    // Extract skill content (markdown fenced block after SKILL FILE marker)
    if (!skillContent && text.includes("SKILL FILE")) {
      const mdMatch = text.match(/```(?:markdown)?\s*\n([\s\S]*?)```/);
      if (mdMatch) skillContent = mdMatch[1].trim();
    }

    // Extract code content (js fenced block after AGENT CODE marker)
    if (!codeContent && text.includes("AGENT CODE")) {
      const jsMatch = text.match(/```(?:javascript|js)?\s*\n([\s\S]*?)```/);
      if (jsMatch) codeContent = jsMatch[1].trim();
    }
  }

  return { agentName, skillContent, codeContent, domain };
}

function detectPhase(output) {
  if (output.includes("DEPLOYMENT COMPLETE")) return "deployed";
  if (output.includes("VALIDATION PASSED")) return "validated";
  if (output.includes("VALIDATION FAILED")) return "validation-failed";
  if (output.includes("AGENT CODE — READY FOR REVIEW")) return "phase-2-review";
  if (output.includes("SKILL FILE — READY FOR REVIEW")) return "phase-1-review";
  return "in-progress";
}
