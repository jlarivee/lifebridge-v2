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
  const changeType = (change.type || "").toLowerCase().trim();
  let applied = "";
  let actionType = "unknown";

  // Fuzzy type matching
  const isSkillEdit = ["skill edit", "skill modification", "system prompt edit", "system prompt update", "prompt edit", "skill update"].some(t => changeType.includes(t));
  const isRegistryAdd = ["registry addition", "registry update", "agent addition", "add agent", "register agent"].some(t => changeType.includes(t));
  const isConnectorAdd = ["connector addition", "add connector", "connector update"].some(t => changeType.includes(t));
  const isContextAdd = ["context addition", "context update", "add context", "learned pattern", "add preference", "add constraint"].some(t => changeType.includes(t));
  const isNoChange = ["no change", "no changes", "none needed", "no change needed"].some(t => changeType.includes(t));

  if (isSkillEdit) {
    actionType = "skill_edit";
    // Determine which skill file to edit
    let skillFileName = "master-agent.md";
    const proposed = change.proposed || "";
    const evidence = change.evidence || "";
    const combined = (proposed + " " + evidence).toLowerCase();

    // Check if a specific agent skill file is mentioned
    const skillsDir = path.join(__dirname, "..", "skills");
    try {
      const skillFiles = fs.readdirSync(skillsDir).filter(f => f.endsWith(".md"));
      for (const sf of skillFiles) {
        const baseName = sf.replace(".md", "");
        if (combined.includes(baseName) && baseName !== "master-agent") {
          skillFileName = sf;
          break;
        }
      }
    } catch {}

    const skillPath = path.join(__dirname, "..", "skills", skillFileName);
    const current = change.current || "";
    if (current && proposed && fs.existsSync(skillPath)) {
      let content = fs.readFileSync(skillPath, "utf-8");
      if (content.includes(current)) {
        content = content.replace(current, proposed);
        fs.writeFileSync(skillPath, content, "utf-8");
        applied = `Skill edit (${skillFileName}): replaced '${current.slice(0, 60)}...' with '${proposed.slice(0, 60)}...'`;
      } else {
        content += "\n\n" + proposed;
        fs.writeFileSync(skillPath, content, "utf-8");
        applied = `Skill edit (${skillFileName}): exact match not found, appended proposed text`;
      }
    } else if (proposed && !current) {
      // Append-only skill edit (no current text to replace)
      if (fs.existsSync(skillPath)) {
        let content = fs.readFileSync(skillPath, "utf-8");
        content += "\n\n" + proposed;
        fs.writeFileSync(skillPath, content, "utf-8");
        applied = `Skill edit (${skillFileName}): appended new content`;
      } else {
        applied = `Skill edit: target file ${skillFileName} not found`;
      }
    } else {
      applied = "Skill edit: missing current/proposed text or skill file not found";
    }
  } else if (isRegistryAdd) {
    actionType = "registry_addition";
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
  } else if (isConnectorAdd) {
    actionType = "connector_addition";
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
  } else if (isContextAdd) {
    actionType = "context_addition";
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
  } else if (isNoChange) {
    actionType = "no_change";
    applied = "No change needed -- acknowledged";
  } else {
    actionType = "unknown";
    applied = `Unknown change type: ${changeType}`;
  }

  // Log execution
  try {
    await logExecution({
      source: "improvement",
      proposal_id: proposalId,
      change_index: changeIndex,
      action_type: actionType,
      change_type: changeType,
      description: applied,
      success: !applied.startsWith("Unknown"),
    });
  } catch (e) {
    console.log("[EXEC-LOG] Failed to log execution:", e.message);
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

// ── Execution Logging ──────────────────────────────────────────────────────

async function logExecution(entry) {
  const id = crypto.randomUUID();
  const log = {
    id,
    timestamp: new Date().toISOString(),
    source: entry.source || "unknown",
    proposal_id: entry.proposal_id || null,
    change_index: entry.change_index ?? null,
    action_type: entry.action_type || "unknown",
    change_type: entry.change_type || "",
    description: entry.description || "",
    success: entry.success !== false,
  };
  await db.set(`execution-log:${id}`, log);
  return log;
}

export { logExecution };
