/**
 * LifeBridge Registry Integrity Agent
 * Verifies registry ↔ filesystem ↔ route consistency.
 * Never modifies anything — report only.
 */

import { existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { readRegistry } from "../tools/registry-tools.js";
import * as db from "../db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = join(__dirname, ".");
const SKILLS_DIR = join(__dirname, "../skills");

// Core files that are not spoke agents — skip in orphan detection
const CORE_FILES = new Set([
  "master-agent.js", "improvement-agent.js", "agent-builder-agent.js",
  "test-agent.js", "registry-integrity-agent.js",
]);
const CORE_SKILLS = new Set([
  "master-agent.md", "improvement-agent.md", "agent-builder-agent.md",
  "test-agent.md", "registry-integrity-agent.md",
]);

const PORT = process.env.PORT || 5000;

/**
 * Run a full integrity check. If agentName is provided, check only that agent.
 */
export async function runIntegrityCheck(trigger = "manual", agentName = null) {
  const registry = await readRegistry();
  const allAgents = (registry.agents || []).filter(a => a.status === "Active");
  const agents = agentName
    ? allAgents.filter(a => a.name === agentName)
    : allAgents;

  const issues = [];
  let healthy = 0;

  // ── Per-agent checks ────────────────────────────────────────────

  for (const agent of agents) {
    const name = agent.name;
    let agentHealthy = true;

    // 1. Code file
    const codePath = join(AGENTS_DIR, `${name}.js`);
    if (!existsSync(codePath)) {
      issues.push({
        agent_name: name, severity: "critical", type: "missing_code_file",
        detail: `Expected file not found: src/agents/${name}.js`,
        recommended_action: `Re-deploy ${name} or remove from registry`,
      });
      agentHealthy = false;
    }

    // 2. Skill file
    const skillPath = join(SKILLS_DIR, `${name}.md`);
    if (!existsSync(skillPath)) {
      issues.push({
        agent_name: name, severity: "critical", type: "missing_skill_file",
        detail: `Expected file not found: src/skills/${name}.md`,
        recommended_action: `Re-deploy ${name} skill file or remove from registry`,
      });
      agentHealthy = false;
    }

    // 3. Route responds (via dedicated health endpoint)
    try {
      const resp = await fetch(`http://localhost:${PORT}/agents/${name}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.status === 404) {
        issues.push({
          agent_name: name, severity: "critical", type: "route_not_responding",
          detail: `GET /agents/${name}/health returned 404 — no health endpoint registered`,
          recommended_action: `Restart server to register health endpoints, or re-deploy agent`,
        });
        agentHealthy = false;
      } else if (resp.status !== 200) {
        issues.push({
          agent_name: name, severity: "warning", type: "route_not_responding",
          detail: `GET /agents/${name}/health returned HTTP ${resp.status}`,
          recommended_action: `Check agent for errors`,
        });
      }
    } catch (e) {
      issues.push({
        agent_name: name, severity: "critical", type: "route_not_responding",
        detail: `GET /agents/${name}/health failed: ${e.message}`,
        recommended_action: `Route unreachable — check server status`,
      });
      agentHealthy = false;
    }

    // 4. Registry entry completeness
    if (!agent.name || !agent.domain || !agent.status) {
      issues.push({
        agent_name: name, severity: "warning", type: "incomplete_registry_entry",
        detail: `Missing fields: ${[!agent.name && "name", !agent.domain && "domain", !agent.status && "status"].filter(Boolean).join(", ")}`,
        recommended_action: `Update registry entry for ${name}`,
      });
      agentHealthy = false;
    }

    if (agentHealthy) healthy++;
  }

  // ── Filesystem consistency (only on full checks) ────────────────

  if (!agentName) {
    const registeredNames = new Set(allAgents.map(a => a.name));

    // 5. Orphaned code files
    try {
      const codeFiles = readdirSync(AGENTS_DIR).filter(f => f.endsWith(".js"));
      for (const file of codeFiles) {
        if (CORE_FILES.has(file)) continue;
        const name = file.replace(".js", "");
        if (!registeredNames.has(name)) {
          issues.push({
            agent_name: name, severity: "warning", type: "orphaned_code_file",
            detail: `src/agents/${file} exists but ${name} is not in registry`,
            recommended_action: `Register ${name} or delete the orphaned file`,
          });
        }
      }
    } catch {}

    // 6. Orphaned skill files
    try {
      const skillFiles = readdirSync(SKILLS_DIR).filter(f => f.endsWith(".md"));
      for (const file of skillFiles) {
        if (CORE_SKILLS.has(file)) continue;
        const name = file.replace(".md", "");
        if (!registeredNames.has(name)) {
          issues.push({
            agent_name: name, severity: "warning", type: "orphaned_skill_file",
            detail: `src/skills/${file} exists but ${name} is not in registry`,
            recommended_action: `Register ${name} or delete the orphaned file`,
          });
        }
      }
    } catch {}

    // 7. Ghost registry entries
    for (const agent of allAgents) {
      if (CORE_FILES.has(`${agent.name}.js`)) continue;
      const codePath = join(AGENTS_DIR, `${agent.name}.js`);
      const skillPath = join(SKILLS_DIR, `${agent.name}.md`);
      if (!existsSync(codePath) && !existsSync(skillPath)) {
        // Only flag if not already flagged as missing_code_file
        const alreadyFlagged = issues.some(i =>
          i.agent_name === agent.name && (i.type === "missing_code_file" || i.type === "ghost_registry_entry")
        );
        if (!alreadyFlagged) {
          issues.push({
            agent_name: agent.name, severity: "critical", type: "ghost_registry_entry",
            detail: `Registry entry exists but no files found on disk for ${agent.name}`,
            recommended_action: `Remove ${agent.name} from registry or re-deploy it`,
          });
        }
      }
    }
  }

  // ── Build report ────────────────────────────────────────────────

  const criticals = issues.filter(i => i.severity === "critical").length;
  const warnings = issues.filter(i => i.severity === "warning").length;
  const status = criticals > 0 ? "critical" : warnings > 0 ? "degraded" : "healthy";

  const report = {
    report_id: uuidv4(),
    run_at: new Date().toISOString(),
    trigger,
    status,
    agents_checked: agents.length,
    agents_healthy: healthy,
    issues,
    summary: status === "healthy"
      ? `All ${agents.length} agents healthy — no issues found`
      : `${criticals} critical, ${warnings} warning(s) across ${agents.length} agents`,
  };

  await db.set(`integrity-report:${report.report_id}`, report);
  return report;
}

/**
 * Get recent integrity reports.
 */
export async function getIntegrityReports(limit = 20) {
  const keys = await db.list("integrity-report:");
  const reports = [];
  for (const key of keys) {
    const r = await db.get(key);
    if (r) reports.push(r);
  }
  reports.sort((a, b) => (b.run_at || "").localeCompare(a.run_at || ""));
  return reports.slice(0, limit);
}
