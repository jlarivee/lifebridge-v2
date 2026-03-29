/**
 * LifeBridge Auto-Registration System
 *
 * Scans src/agents/ for any agent file that exports AGENT_META.
 * If the agent isn't in the registry, registers it automatically.
 * Runs on every server startup — zero manual steps needed.
 *
 * To make a new agent auto-register:
 * 1. Export AGENT_META from your agent file with: name, domain, purpose,
 *    status, trigger_patterns, endpoints, requires_approval
 * 2. That's it. The next server restart will pick it up.
 */

import { readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readRegistry, writeRegistry } from "./tools/registry-tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = join(__dirname, "agents");

/**
 * Remove registry entries whose code file doesn't exist on disk.
 * Prevents ghost agents from accumulating after renames/deletions.
 */
function pruneGhostAgents(registry) {
  const before = registry.agents.length;
  registry.agents = registry.agents.filter(a => {
    const codePath = a.code_file
      ? join(__dirname, "..", a.code_file)
      : join(AGENTS_DIR, `${a.name}.js`);
    if (existsSync(codePath)) return true;
    console.log(`[AUTO-REG] Pruned ghost agent: ${a.name} (file missing: ${codePath})`);
    return false;
  });
  return before - registry.agents.length;
}

/**
 * Scan all agent files for AGENT_META exports and register any
 * that are missing from the registry. Idempotent — safe to call
 * on every startup.
 */
export async function autoRegisterAllAgents() {
  const registry = await readRegistry();
  registry.agents = registry.agents || [];

  // Prune agents whose files no longer exist
  const pruned = pruneGhostAgents(registry);

  const existingNames = new Set(registry.agents.map(a => a.name));

  const files = readdirSync(AGENTS_DIR).filter(
    f => f.endsWith("-agent.js") || f.endsWith("-agent.mjs")
  );

  let registered = 0;
  const errors = [];

  for (const file of files) {
    const filePath = join(AGENTS_DIR, file);
    try {
      const mod = await import(filePath);
      if (!mod.AGENT_META) continue; // No meta = skip (legacy agent, registered elsewhere)

      const meta = mod.AGENT_META;
      if (!meta.name) {
        errors.push(`${file}: AGENT_META missing 'name'`);
        continue;
      }

      if (existingNames.has(meta.name)) continue; // Already registered

      // Register the agent
      registry.agents.push({
        name: meta.name,
        domain: meta.domain || "System",
        purpose: meta.purpose || "",
        status: meta.status || "Active",
        skill_file: meta.skill_file || `src/skills/${meta.name}.md`,
        code_file: meta.code_file || `src/agents/${meta.name}.js`,
        trigger_patterns: meta.trigger_patterns || [],
        triggers: meta.triggers || ["manual"],
        endpoints: meta.endpoints || [`/agents/${meta.name}`],
        requires_approval: meta.requires_approval || [],
        created_at: new Date().toISOString(),
      });

      existingNames.add(meta.name);
      registered++;
      console.log(`[AUTO-REG] Registered new agent: ${meta.name} (${meta.domain})`);

      // Call optional init function if the agent exports one
      if (typeof mod.initAgent === "function") {
        try {
          await mod.initAgent();
          console.log(`[AUTO-REG] Ran initAgent() for ${meta.name}`);
        } catch (e) {
          console.log(`[AUTO-REG] initAgent() failed for ${meta.name}: ${e.message}`);
        }
      }
    } catch (e) {
      // Import failures are expected for agents with unresolved deps at scan time
      // (they'll be loaded properly later by the dynamic loader or static imports)
      if (!e.message.includes("Cannot find module")) {
        errors.push(`${file}: ${e.message}`);
      }
    }
  }

  if (registered > 0 || pruned > 0) {
    await writeRegistry(registry);
  }

  if (pruned > 0) {
    console.log(`[AUTO-REG] Pruned ${pruned} ghost agent(s)`);
  }

  if (errors.length > 0) {
    console.log(`[AUTO-REG] ${errors.length} error(s): ${errors.join("; ")}`);
  }

  return { registered, pruned, total_scanned: files.length, errors };
}
