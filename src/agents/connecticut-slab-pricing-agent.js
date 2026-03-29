import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const skill = readFileSync(
  join(__dirname, "../skills/connecticut-slab-pricing-agent.md"),
  "utf8"
);

const client = new Anthropic();

const APPROVED_TOOLS = [
  { type: "web_search_20250305", name: "web_search" },
  { type: "file_reading", name: "file_reading" },
  { type: "code_execution", name: "code_execution" }
];

export async function runConnecticutSlabPricingAgent(request, context = {}) {
  const systemPrompt = `${skill}

Context from master agent:
${JSON.stringify(context, null, 2)}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    tools: APPROVED_TOOLS,
    max_turns: 5,
    messages: [{ role: "user", content: request }],
  });

  const output = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();

  return {
    agent: "connecticut-slab-pricing-agent",
    request,
    output: output || "No pricing data found",
    requires_approval: false,
    approval_reason: null,
  };
}