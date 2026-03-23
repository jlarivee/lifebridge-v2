import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as db from "../db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(
  join(__dirname, "../skills/slab-inventory-tracker-agent.md"),
  "utf8"
);

const client = new Anthropic();

export async function runSlabInventoryTracker(request, context = {}) {
  // Load current inventory from DB for context
  let inventory = await db.get("slab-inventory") || [];

  const systemPrompt = `${skill}

Current inventory (${inventory.length} slabs):
${JSON.stringify(inventory, null, 2)}

Context from master agent:
${JSON.stringify(context, null, 2)}

When adding or updating slabs, output the complete updated slab record
as JSON in your response so the caller can save it. Wrap slab data in
a code block labeled \`\`\`json so it can be parsed.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: request }],
  });

  const output = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();

  // Try to extract and save any slab data from the response
  try {
    const jsonMatch = output.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[1]);
      if (Array.isArray(data)) {
        await db.set("slab-inventory", data);
      } else if (data.id) {
        // Single slab — upsert into inventory
        const idx = inventory.findIndex(s => s.id === data.id);
        if (idx >= 0) inventory[idx] = data;
        else inventory.push(data);
        await db.set("slab-inventory", inventory);
      }
    }
  } catch {}

  return {
    agent: "slab-inventory-tracker-agent",
    request,
    output: output || "No output produced",
    requires_approval: false,
    approval_reason: null,
  };
}
