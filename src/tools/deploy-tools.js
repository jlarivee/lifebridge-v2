/**
 * Deploy Tools — writes agent files to disk and commits to GitHub.
 * Called by the agent builder after Phase 4 approval.
 */

import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { readRegistry, writeRegistry } from "./registry-tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "..");
const SKILLS_DIR = join(SRC_DIR, "skills");
const AGENTS_DIR = join(SRC_DIR, "agents");

/**
 * Write skill and code files to disk for a new agent.
 * Returns paths of written files.
 */
export function writeAgentFiles(agentName, skillContent, codeContent) {
  const skillPath = join(SKILLS_DIR, `${agentName}.md`);
  const codePath = join(AGENTS_DIR, `${agentName}.js`);

  writeFileSync(skillPath, skillContent, "utf8");
  console.log(`[DEPLOY] Wrote skill: ${skillPath}`);

  writeFileSync(codePath, codeContent, "utf8");
  console.log(`[DEPLOY] Wrote code: ${codePath}`);

  return { skillPath, codePath };
}

/**
 * Register a new agent in the Replit Database registry.
 */
export async function registerAgent(agentEntry) {
  const registry = await readRegistry();
  const exists = (registry.agents || []).some(a => a.name === agentEntry.name);
  if (!exists) {
    registry.agents = registry.agents || [];
    registry.agents.push(agentEntry);
    await writeRegistry(registry);
    console.log(`[DEPLOY] Registered in DB: ${agentEntry.name}`);
  }
  return registry;
}

/**
 * Commit agent files to GitHub via the API.
 * Best-effort — never crashes the caller.
 */
export async function commitToGitHub(agentName, skillContent, codeContent) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    console.log("[DEPLOY] GitHub sync skipped — GITHUB_TOKEN or GITHUB_REPO not set");
    return { synced: false, reason: "not configured" };
  }

  const files = [
    { path: `src/skills/${agentName}.md`, content: skillContent },
    { path: `src/agents/${agentName}.js`, content: codeContent },
  ];

  const results = [];
  for (const file of files) {
    try {
      const b64 = Buffer.from(file.content).toString("base64");
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      };
      const url = `https://api.github.com/repos/${repo}/contents/${file.path}`;

      // Get current SHA if file exists
      let sha = null;
      try {
        const getResp = await fetch(url, { headers });
        if (getResp.ok) {
          const data = await getResp.json();
          sha = data.sha;
        }
      } catch {}

      const body = {
        message: `Deploy agent: ${agentName} — ${file.path}`,
        content: b64,
        branch: "main",
      };
      if (sha) body.sha = sha;

      const putResp = await fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify(body),
      });

      if (putResp.ok) {
        const data = await putResp.json();
        console.log(`[DEPLOY] GitHub: committed ${file.path}`);
        results.push({ path: file.path, synced: true, sha: data.commit?.sha });
      } else {
        console.log(`[DEPLOY] GitHub: failed ${file.path} (${putResp.status})`);
        results.push({ path: file.path, synced: false });
      }
    } catch (e) {
      console.log(`[DEPLOY] GitHub: error ${file.path}: ${e.message}`);
      results.push({ path: file.path, synced: false });
    }
  }

  return { synced: results.every(r => r.synced), files: results };
}

/**
 * Full deployment: write files + register + GitHub commit.
 */
export async function deployAgent(agentName, skillContent, codeContent, registryEntry) {
  // 1. Write to disk
  const paths = writeAgentFiles(agentName, skillContent, codeContent);

  // 2. Register in DB
  await registerAgent(registryEntry);

  // 3. Commit to GitHub (best-effort)
  const githubResult = await commitToGitHub(agentName, skillContent, codeContent);

  return {
    deployed: true,
    agent: agentName,
    paths,
    github: githubResult,
  };
}
