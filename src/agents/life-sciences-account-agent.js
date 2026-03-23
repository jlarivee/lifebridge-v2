import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(
  join(__dirname, "../skills/life-sciences-account-agent.md"),
  "utf8"
);

const client = new Anthropic();

export async function runAccountAgent(request, context = {}) {
  const systemPrompt = `${skill}

You have access to web search. Use it before producing any output.
Search for current news and signals about the account or executive
mentioned in the request before writing anything.

Context from master agent:
${JSON.stringify(context, null, 2)}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: request }],
  });

  const output = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();

  return {
    agent: "life-sciences-account-agent",
    request,
    output: output || "No output produced",
    requires_approval:
      request.toLowerCase().includes("email") ||
      request.toLowerCase().includes("send") ||
      request.toLowerCase().includes("outreach"),
  };
}
