/**
 * Dynamic Agent Loader
 * Reads the registry from Replit Database, finds all active agents,
 * checks if their files exist on disk, and registers Express routes.
 *
 * Core agents (master, improvement, builder) are imported statically.
 * Deployed spoke agents are loaded dynamically via import().
 */

import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readRegistry } from "./tools/registry-tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = join(__dirname, "agents");

// Agents that are statically imported in index.js — skip dynamic loading
const STATIC_AGENTS = new Set([
  "life-sciences-account-agent",
  "agent-builder-agent",
  "travel-agent",
]);

/**
 * Dynamically load all active agents from the registry and mount
 * their Express routes. Returns count of dynamically loaded agents.
 */
export async function loadDynamicAgents(app) {
  const registry = await readRegistry();
  const agents = (registry.agents || []).filter(a => a.status === "Active");
  let loaded = 0;

  for (const agent of agents) {
    if (STATIC_AGENTS.has(agent.name)) continue;

    const codePath = join(AGENTS_DIR, `${agent.name}.js`);
    if (!existsSync(codePath)) {
      console.log(`[LOADER] Agent ${agent.name} registered but file missing: ${codePath}`);
      continue;
    }

    try {
      // Dynamic import of the agent module
      const mod = await import(codePath);

      // Find the exported run function — convention: run[PascalName] or default export
      const funcName = Object.keys(mod).find(k => k.startsWith("run"));
      const runFn = funcName ? mod[funcName] : mod.default;

      if (typeof runFn !== "function") {
        console.log(`[LOADER] Agent ${agent.name}: no run function found, skipping`);
        continue;
      }

      // Derive route path from agent name: "my-agent" → "/agents/my-agent"
      const routePath = `/agents/${agent.name}`;

      // Check if route already exists
      const existing = app._router?.stack?.some(
        layer => layer.route?.path === routePath
      );
      if (existing) {
        console.log(`[LOADER] Agent ${agent.name}: route ${routePath} already exists, skipping`);
        continue;
      }

      // Mount the route
      app.post(routePath, async (req, res) => {
        try {
          const { input, context } = req.body || {};
          if (!input) return res.status(400).json({ error: "input required" });
          const result = await runFn(input, context || {});
          res.json(result);
        } catch (e) {
          res.status(500).json({ error: e.message });
        }
      });

      loaded++;
      console.log(`[LOADER] Loaded dynamic agent: ${agent.name} → POST ${routePath}`);
    } catch (e) {
      console.log(`[LOADER] Failed to load ${agent.name}: ${e.message}`);
    }
  }

  return loaded;
}
