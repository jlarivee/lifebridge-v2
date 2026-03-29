import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const skill = readFileSync(
  join(__dirname, "../skills/three-rivers-social-agent.md"),
  "utf8"
);

const client = new Anthropic();

const APPROVED_TOOLS = [
  { type: "api_calls", name: "api_calls" }
];

export async function runThreeRiversSocialAgent(request, context = {}) {
  const systemPrompt = `${skill}

Context from master agent:
${JSON.stringify(context, null, 2)}`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    tools: APPROVED_TOOLS,
    messages: [{ role: "user", content: request }],
    max_turns: 5,
  });

  // First, check if the agent made any tool calls to get inventory data
  let finalOutput = "";
  let toolResults = [];

  if (response.content.some(block => block.type === "tool_use")) {
    // Handle API calls to slab-inventory-tracker-agent
    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "api_calls") {
        try {
          // Make the API call to get inventory data
          const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 5400}`;
          const apiResponse = await fetch(`${baseUrl}/agents/slab-inventory-tracker-agent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              request: "Get current inventory data for social media content creation",
              filter: block.input.filter || null
            })
          });
          
          const inventoryData = await apiResponse.json();
          toolResults.push({
            tool_use_id: block.id,
            content: JSON.stringify(inventoryData, null, 2)
          });
        } catch (error) {
          toolResults.push({
            tool_use_id: block.id,
            content: `Error accessing inventory data: ${error.message}`
          });
        }
      }
    }

    // Continue conversation with tool results
    const followUpResponse = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      tools: APPROVED_TOOLS,
      messages: [
        { role: "user", content: request },
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults }
      ],
    });

    finalOutput = followUpResponse.content
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim();
  } else {
    finalOutput = response.content
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim();
  }

  return {
    agent: "three-rivers-social-agent",
    request,
    output: finalOutput || "No output produced",
    requires_approval: false,
    approval_reason: null,
  };
}