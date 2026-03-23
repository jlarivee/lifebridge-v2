import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

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

export async function runAgentBuilder(buildBrief, context = {}) {
  const systemPrompt = `${skill}

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

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{
      role: "user",
      content: `Execute the 4-phase Agent Builder pipeline for this build brief.
Start with Phase 1 — write the skill file and output it for review.
Label your output clearly at each phase boundary.
Pause after Phase 1 output and wait for approval signal before Phase 2.`,
    }],
  });

  const output = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();

  return {
    agent: "agent-builder-agent",
    phase: detectPhase(output),
    output: output || "No output produced",
    requires_approval: true,
    approval_reason: "Agent deployment requires explicit human approval",
  };
}

function detectPhase(output) {
  if (output.includes("DEPLOYMENT COMPLETE")) return "deployed";
  if (output.includes("VALIDATION PASSED")) return "validated";
  if (output.includes("VALIDATION FAILED")) return "validation-failed";
  if (output.includes("AGENT CODE — READY FOR REVIEW")) return "phase-2-review";
  if (output.includes("SKILL FILE — READY FOR REVIEW")) return "phase-1-review";
  return "in-progress";
}
