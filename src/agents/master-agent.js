import Anthropic from "@anthropic-ai/sdk";
import { readRegistry } from "../tools/registry-tools.js";
import { readContext } from "../tools/context-tools.js";
import { logRequest } from "../tools/log-tools.js";
import { v4 as uuidv4 } from "uuid";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillContent = fs.readFileSync(path.join(__dirname, "../skills/master-agent.md"), "utf-8");
const client = new Anthropic();

function parseField(text, field) {
  const m = text.match(new RegExp(`${field}:\\s*(.+)`));
  return m ? m[1].trim() : "";
}

function parseConfidence(text) {
  const m = text.match(/Confidence:\s*(\d+)\/100/);
  return m ? parseInt(m[1]) : null;
}

export async function route(userInput) {
  const registry = await readRegistry();
  const context = await readContext();

  let registryBlock = `[REGISTRY STATE]
Agents: ${JSON.stringify(registry.agents || [])}
Connectors: ${JSON.stringify(registry.connectors || [])}
Claude-native capabilities: ${JSON.stringify(registry.claude_capabilities || [])}
Domain signals learned: ${JSON.stringify(registry.domain_signals || [])}
[END REGISTRY STATE]`;

  let contextBlock = "";
  const prefs = (context.preferences || []).map(e => e.content).filter(Boolean);
  const constraints = (context.constraints || []).map(e => e.content).filter(Boolean);
  const patterns = (context.learned_patterns || []).map(e => e.content).filter(Boolean);
  if (prefs.length || constraints.length || patterns.length) {
    const parts = ["[GLOBAL CONTEXT]"];
    if (prefs.length) parts.push("Preferences: " + prefs.join("; "));
    if (constraints.length) parts.push("Constraints: " + constraints.join("; "));
    if (patterns.length) parts.push("Learned patterns: " + patterns.join("; "));
    parts.push("[END GLOBAL CONTEXT]");
    contextBlock = "\n\n" + parts.join("\n");
  }

  const combinedMessage = registryBlock + contextBlock + "\n\nUser request: " + userInput;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2048,
    system: skillContent,
    messages: [{ role: "user", content: combinedMessage }],
  });

  const responseText = response.content.map(b => b.text || "").join("").trim();
  const confidence = parseConfidence(responseText);

  const entry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    input: userInput,
    domain: parseField(responseText, "Domain"),
    routed_to: parseField(responseText, "Route to"),
    approval_required: responseText.includes("APPROVAL REQUIRED"),
    clarification_asked: responseText.includes("?") && !responseText.includes("ROUTING PACKAGE"),
    build_brief_triggered: responseText.includes("BUILD BRIEF"),
    confidence,
    outcome: null,
    feedback: null,
    raw_response: responseText,
  };

  await logRequest(entry);
  return { id: entry.id, confidence, response: responseText };
}
