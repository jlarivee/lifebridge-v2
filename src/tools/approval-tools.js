import { readRegistry, writeRegistry } from "./registry-tools.js";
import { readContext, writeContext } from "./context-tools.js";
import * as db from "../db.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseChanges(proposalText) {
  const changes = [];
  const parts = proposalText.split(/Change\s*\[?\d+\]?\s*:/);
  if (parts.length <= 1) return changes;

  for (const part of parts.slice(1)) {
    const change = {};
    for (const field of ["Type", "Evidence", "Current", "Proposed", "Reasoning", "Risk", "Confidence"]) {
      const match = part.match(
        new RegExp(
          `${field}:\\s*(.*?)(?=\\n\\s*(?:Type|Evidence|Current|Proposed|Reasoning|Risk|Confidence|Change|OVERALL|$))`,
          "s"
        )
      );
      if (match) {
        change[field.toLowerCase()] = match[1].trim();
      }
    }
    if (Object.keys(change).length > 0) {
      changes.push(change);
    }
  }
  return changes;
}

export async function approveChange(proposalId, changeIndex) {
  const proposal = await db.get(`improvement:${proposalId}`);
  if (!proposal) throw new Error(`Proposal ${proposalId} not found`);

  const changes = parseChanges(proposal.proposal);
  if (changeIndex < 0 || changeIndex >= changes.length) {
    throw new Error(`Change index ${changeIndex} out of range (0-${changes.length - 1})`);
  }

  const change = changes[changeIndex];
  const changeType = (change.type || "").toLowerCase();
  let applied = "";

  if (changeType.includes("skill edit") || changeType.includes("system prompt edit")) {
    const skillPath = path.join(__dirname, "..", "skills", "master-agent.md");
    const current = change.current || "";
    const proposed = change.proposed || "";
    if (current && proposed && fs.existsSync(skillPath)) {
      let content = fs.readFileSync(skillPath, "utf-8");
      if (content.includes(current)) {
        content = content.replace(current, proposed);
        fs.writeFileSync(skillPath, content, "utf-8");
        applied = `Skill edit: replaced '${current.slice(0, 50)}...' with '${proposed.slice(0, 50)}...'`;
      } else {
        content += `\n\n${proposed}`;
        fs.writeFileSync(skillPath, content, "utf-8");
        applied = `Skill edit: exact match not found, appended proposed text`;
      }
    } else {
      applied = "Skill edit: missing current/proposed text or skill file not found";
    }
  } else if (changeType.includes("registry addition")) {
    const proposed = change.proposed || "";
    const registry = await readRegistry();
    let entry;
    try {
      entry = proposed.trim().startsWith("{") ? JSON.parse(proposed) : { entry: proposed };
    } catch {
      entry = { entry: proposed };
    }
    registry.agents.push(entry);
    await writeRegistry(registry);
    applied = "Registry addition: added to agents list";
  } else if (changeType.includes("connector addition")) {
    const proposed = change.proposed || "";
    const registry = await readRegistry();
    let entry;
    try {
      entry = proposed.trim().startsWith("{") ? JSON.parse(proposed) : { entry: proposed };
    } catch {
      entry = { entry: proposed };
    }
    if (!registry.connectors) registry.connectors = [];
    registry.connectors.push(entry);
    await writeRegistry(registry);
    applied = "Connector addition: added to connectors list";
  } else if (changeType.includes("context addition")) {
    const proposed = change.proposed || "";
    const context = await readContext();
    const lower = proposed.toLowerCase();

    let targetArray = "learned_patterns";
    if (["prefer", "always use", "default to", "style"].some((w) => lower.includes(w))) {
      targetArray = "preferences";
    } else if (["never", "must not", "constraint", "forbidden", "require"].some((w) => lower.includes(w))) {
      targetArray = "constraints";
    }

    const entry = {
      id: crypto.randomUUID(),
      content: proposed,
      source: "improvement_agent",
      added: new Date().toISOString(),
      approved_by: "human",
    };

    if (!context[targetArray]) context[targetArray] = [];
    context[targetArray].push(entry);
    context.last_updated = new Date().toISOString();
    await writeContext(context);
    applied = `Context addition: added to ${targetArray}`;
  } else if (changeType.includes("no change")) {
    applied = "No change needed — acknowledged";
  } else {
    applied = `Unknown change type: ${changeType}`;
  }

  if (!proposal.approved_changes) proposal.approved_changes = [];
  proposal.approved_changes.push({
    change_index: changeIndex,
    committed_at: new Date().toISOString(),
    description: applied,
  });

  const totalChanges = changes.length;
  const resolved = (proposal.approved_changes || []).length + (proposal.rejected_changes || []).length;
  if (resolved >= totalChanges) {
    proposal.status = "resolved";
  }

  await db.set(`improvement:${proposalId}`, proposal);
  return applied;
}

export async function rejectChange(proposalId, changeIndex) {
  const proposal = await db.get(`improvement:${proposalId}`);
  if (!proposal) throw new Error(`Proposal ${proposalId} not found`);

  if (!proposal.rejected_changes) proposal.rejected_changes = [];
  proposal.rejected_changes.push({
    change_index: changeIndex,
    rejected_at: new Date().toISOString(),
  });

  const changes = parseChanges(proposal.proposal);
  const totalChanges = changes.length;
  const resolved = (proposal.approved_changes || []).length + (proposal.rejected_changes || []).length;
  if (resolved >= totalChanges) {
    proposal.status = "resolved";
  }

  await db.set(`improvement:${proposalId}`, proposal);
}
