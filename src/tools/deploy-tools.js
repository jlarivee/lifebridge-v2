/**
 * Deploy Tools — writes agent files to disk and commits to GitHub.
 * Called by the agent builder after Phase 4 approval.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
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

// ── Enhancement deployment (arbitrary file writes) ────────────────────────────

const PROJECT_ROOT = join(SRC_DIR, "..");

// Allowed directories for enhancement writes — guardrail
const ALLOWED_PREFIXES = [
  "src/agents/",
  "src/skills/",
  "public/js/",
  "public/css/",
];

function isPathAllowed(filePath) {
  return ALLOWED_PREFIXES.some(prefix => filePath.startsWith(prefix));
}

/**
 * Write multiple files to disk for an enhancement.
 * Each file: { path: "relative/to/project", content: "..." }
 * Returns list of written paths.
 */
export function writeEnhancementFiles(files) {
  const written = [];
  for (const file of files) {
    if (!isPathAllowed(file.path)) {
      console.log(`[ENHANCE] BLOCKED: ${file.path} — not in allowed directories`);
      continue;
    }
    const fullPath = join(PROJECT_ROOT, file.path);
    const dir = dirname(fullPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, file.content, "utf8");
    console.log(`[ENHANCE] Wrote: ${file.path}`);
    written.push(file.path);
  }
  return written;
}

/**
 * Commit multiple arbitrary files to GitHub.
 * Each file: { path: "relative/to/project", content: "..." }
 */
export async function commitFilesToGitHub(agentName, files) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    console.log("[ENHANCE] GitHub sync skipped — GITHUB_TOKEN or GITHUB_REPO not set");
    return { synced: false, reason: "not configured" };
  }

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

      let sha = null;
      try {
        const getResp = await fetch(url, { headers });
        if (getResp.ok) {
          const data = await getResp.json();
          sha = data.sha;
        }
      } catch {}

      const body = {
        message: `Enhance ${agentName}: ${file.path}`,
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
        console.log(`[ENHANCE] GitHub: committed ${file.path}`);
        results.push({ path: file.path, synced: true });
      } else {
        console.log(`[ENHANCE] GitHub: failed ${file.path} (${putResp.status})`);
        results.push({ path: file.path, synced: false });
      }
    } catch (e) {
      console.log(`[ENHANCE] GitHub: error ${file.path}: ${e.message}`);
      results.push({ path: file.path, synced: false });
    }
  }

  return { synced: results.every(r => r.synced), files: results };
}

/**
 * Full enhancement deployment: write files + GitHub commit.
 * No registry changes needed — agent already exists.
 */
export async function deployEnhancement(agentName, files) {
  const written = writeEnhancementFiles(files);
  const githubResult = await commitFilesToGitHub(agentName, files.filter(f => isPathAllowed(f.path)));

  return {
    deployed: true,
    mode: "enhance",
    agent: agentName,
    files_written: written,
    github: githubResult,
  };
}

// ── Rollback safety net ───────────────────────────────────────────────────────

/**
 * Backup files before writing. Returns a backup map: { path: content | null }.
 * null means the file didn't exist (new file).
 */
export function backupFiles(files) {
  const backup = {};
  for (const file of files) {
    if (!isPathAllowed(file.path)) continue;
    const fullPath = join(PROJECT_ROOT, file.path);
    try {
      if (existsSync(fullPath)) {
        backup[file.path] = readFileSync(fullPath, "utf8");
        console.log(`[BACKUP] Saved: ${file.path}`);
      } else {
        backup[file.path] = null; // new file — delete on rollback
        console.log(`[BACKUP] Marked as new: ${file.path}`);
      }
    } catch (e) {
      console.log(`[BACKUP] Error reading ${file.path}: ${e.message}`);
      backup[file.path] = null;
    }
  }
  return backup;
}

/**
 * Restore files from backup. Writes originals back to disk.
 * If backup value is null (file was new), deletes the file.
 */
export function restoreFiles(backup) {
  const restored = [];
  for (const [filePath, content] of Object.entries(backup)) {
    const fullPath = join(PROJECT_ROOT, filePath);
    try {
      if (content === null) {
        // File was new — remove it
        if (existsSync(fullPath)) {
          unlinkSync(fullPath);
          console.log(`[ROLLBACK] Deleted new file: ${filePath}`);
          restored.push({ path: filePath, action: "deleted" });
        }
      } else {
        // File existed — restore original content
        writeFileSync(fullPath, content, "utf8");
        console.log(`[ROLLBACK] Restored: ${filePath}`);
        restored.push({ path: filePath, action: "restored" });
      }
    } catch (e) {
      console.log(`[ROLLBACK] Error restoring ${filePath}: ${e.message}`);
      restored.push({ path: filePath, action: "error", error: e.message });
    }
  }
  return restored;
}

/**
 * Revert GitHub commits for files. Restores original content from backup.
 * Best-effort — never crashes the caller.
 */
export async function revertGitHubFiles(agentName, backup) {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    console.log("[ROLLBACK] GitHub revert skipped — not configured");
    return { reverted: false, reason: "not configured" };
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  const results = [];
  for (const [filePath, content] of Object.entries(backup)) {
    if (content === null) {
      // New file — would need to delete from GitHub. Skip for safety.
      console.log(`[ROLLBACK] GitHub: skipping delete of new file ${filePath}`);
      results.push({ path: filePath, reverted: false, reason: "new file deletion not supported" });
      continue;
    }

    try {
      const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;

      // Get current SHA
      let sha = null;
      try {
        const getResp = await fetch(url, { headers });
        if (getResp.ok) {
          const data = await getResp.json();
          sha = data.sha;
        }
      } catch {}

      if (!sha) {
        results.push({ path: filePath, reverted: false, reason: "could not get SHA" });
        continue;
      }

      const b64 = Buffer.from(content).toString("base64");
      const putResp = await fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          message: `Rollback ${agentName}: revert ${filePath}`,
          content: b64,
          sha,
          branch: "main",
        }),
      });

      if (putResp.ok) {
        console.log(`[ROLLBACK] GitHub: reverted ${filePath}`);
        results.push({ path: filePath, reverted: true });
      } else {
        console.log(`[ROLLBACK] GitHub: failed to revert ${filePath} (${putResp.status})`);
        results.push({ path: filePath, reverted: false });
      }
    } catch (e) {
      console.log(`[ROLLBACK] GitHub: error reverting ${filePath}: ${e.message}`);
      results.push({ path: filePath, reverted: false, error: e.message });
    }
  }

  return { reverted: results.every(r => r.reverted), files: results };
}

/**
 * Safe enhancement deployment with rollback on test failure.
 * 1. Backup originals
 * 2. Write new files
 * 3. Run tests
 * 4. If tests fail: restore originals + revert GitHub
 * 5. If tests pass: commit to GitHub, done
 */
export async function deployEnhancementSafe(agentName, files) {
  // 1. Backup
  const allowedFiles = files.filter(f => isPathAllowed(f.path));
  const backup = backupFiles(allowedFiles);
  console.log(`[SAFE-DEPLOY] Backed up ${Object.keys(backup).length} files for ${agentName}`);

  // 2. Write new files to disk
  const written = writeEnhancementFiles(allowedFiles);
  console.log(`[SAFE-DEPLOY] Wrote ${written.length} files for ${agentName}`);

  // 3. Run tests
  let testsPassed = false;
  let testOutput = "";
  try {
    const PORT = process.env.PORT || 5000;
    const testResp = await fetch(`http://localhost:${PORT}/test/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (testResp.ok) {
      const testData = await testResp.json();
      testsPassed = (testData.failed || 0) === 0;
      testOutput = `${testData.passed || 0} passed, ${testData.failed || 0} failed`;
      console.log(`[SAFE-DEPLOY] Tests: ${testOutput}`);
    } else {
      testOutput = `Test endpoint returned ${testResp.status}`;
      console.log(`[SAFE-DEPLOY] Test endpoint error: ${testResp.status}`);
    }
  } catch (e) {
    testOutput = `Test run failed: ${e.message}`;
    console.log(`[SAFE-DEPLOY] Test run error: ${e.message}`);
  }

  // 4. If tests failed: ROLLBACK
  if (!testsPassed) {
    console.log(`[SAFE-DEPLOY] TESTS FAILED — rolling back ${agentName}`);

    const restoreResult = restoreFiles(backup);
    console.log(`[SAFE-DEPLOY] Restored ${restoreResult.length} files from backup`);

    return {
      deployed: false,
      mode: "enhance",
      agent: agentName,
      rolled_back: true,
      reason: `Tests failed after enhancement: ${testOutput}`,
      files_restored: restoreResult,
      test_output: testOutput,
    };
  }

  // 5. Tests passed — commit to GitHub
  const githubResult = await commitFilesToGitHub(agentName, allowedFiles);
  console.log(`[SAFE-DEPLOY] Enhancement deployed successfully: ${agentName}`);

  return {
    deployed: true,
    mode: "enhance",
    agent: agentName,
    rolled_back: false,
    files_written: written,
    github: githubResult,
    test_output: testOutput,
  };
}
