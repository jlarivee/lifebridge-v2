import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const skill = readFileSync(
  join(__dirname, "../skills/sawmill-weather-agent.md"),
  "utf8"
);

const client = new Anthropic();

const APPROVED_TOOLS = [
  { type: "web_search_20250305", name: "web_search" },
  { type: "code_execution", name: "code_execution" }
];

export async function runSawmillWeatherAgent(request, context = {}) {
  const systemPrompt = `${skill}

Context from master agent:
${JSON.stringify(context, null, 2)}

SAFETY THRESHOLDS FOR SAWMILL OPERATIONS:
- Wind: Unsafe if sustained winds >20 mph or gusts >30 mph
- Precipitation: Unsafe during any active rain, snow, or sleet
- Visibility: Unsafe if visibility <0.5 miles due to fog/weather
- Humidity: High concern if >85% (affects wood quality)
- Temperature: Note if <32°F (freezing affects equipment/safety)

Always provide timestamp with weather data. Be conservative with safety decisions.`;

  const messages = [{ role: "user", content: request }];

  let totalTokens = 0;
  const MAX_TURNS = 5;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      tools: APPROVED_TOOLS,
      messages: messages,
    });

    totalTokens += response.usage?.total_tokens || 0;
    messages.push({ role: "assistant", content: response.content });

    // Check if Claude wants to use tools
    const toolUses = response.content.filter(block => block.type === "tool_use");
    
    if (toolUses.length === 0) {
      // No tools needed, we have our final answer
      const output = response.content
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("")
        .trim();

      return {
        agent: "sawmill-weather-agent",
        request,
        output: output || "No weather assessment available",
        requires_approval: false,
        approval_reason: null,
        tokens_used: totalTokens
      };
    }

    // Execute tools
    const toolResults = [];
    for (const toolUse of toolUses) {
      try {
        let result;
        if (toolUse.name === "web_search") {
          const searchResponse = await fetch("/api/web-search", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: toolUse.input.query })
          });
          const searchData = await searchResponse.json();
          result = searchData.results || "No search results found";
        } else if (toolUse.name === "code_execution") {
          // For weather calculations or data processing
          const codeResponse = await fetch("/api/code-execution", {
            method: "POST", 
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: toolUse.input.code })
          });
          const codeData = await codeResponse.json();
          result = codeData.result || "Code execution failed";
        }

        toolResults.push({
          tool_use_id: toolUse.id,
          content: [{ type: "text", text: JSON.stringify(result) }]
        });
      } catch (error) {
        toolResults.push({
          tool_use_id: toolUse.id,
          content: [{ type: "text", text: `Error: ${error.message}` }]
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  // If we've exhausted turns without a final answer
  return {
    agent: "sawmill-weather-agent",
    request,
    output: "Weather safety assessment incomplete - maximum turns exceeded. Please try again.",
    requires_approval: false,
    approval_reason: null,
    tokens_used: totalTokens
  };
}