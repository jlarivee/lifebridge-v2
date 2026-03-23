import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const skill = readFileSync(
  join(__dirname, "../skills/[AGENT_SKILL_FILENAME].md"),
  "utf8"
);

const client = new Anthropic();

const APPROVED_TOOLS = [TOOL_LIST];

export async function run[AGENT_FUNCTION_NAME](request, context = {}) {
  const systemPrompt = `${skill}

Context from master agent:
${JSON.stringify(context, null, 2)}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    tools: APPROVED_TOOLS,
    messages: [{ role: "user", content: request }],
  });

  const output = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();

  return {
    agent: "[AGENT_NAME]",
    request,
    output: output || "No output produced",
    requires_approval: [REQUIRES_APPROVAL_BOOLEAN],
    approval_reason: [APPROVAL_REASON_STRING_OR_NULL],
  };
}
