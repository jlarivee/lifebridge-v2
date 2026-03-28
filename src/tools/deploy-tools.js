/**
 * Deploy Tools — writes agent files to disk and commits to GitHub.
 * Called by the agent builder after Phase 4 approval.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
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

/**
 * Full new-agent deployment with UI wiring.
 * Writes files, registers, updates config.js for hub visibility, commits to GitHub.
 * Used by /builder/pending/:id/approve for BUILD mode.
 */
export async function deployNewAgentFull(agentName, files, agentLabel, domain) {
  // 1. Write all files to disk
  const written = writeEnhancementFiles(files);

  // 2. Extract skill + code for GitHub commit
  const skillFile = files.find(f => f.path.startsWith("src/skills/"));
  const codeFile = files.find(f => f.path.startsWith("src/agents/"));

  // 3. Register in DB
  const registryEntry = {
    name: agentName,
    domain: domain || "General",
    status: "Active",
    purpose: `Auto-built agent: ${agentLabel || agentName}`,
    endpoints: [`/agents/${agentName}`],
    created_at: new Date().toISOString(),
  };
  await registerAgent(registryEntry);

  // 4. Update config.js — adds to AGENT_ENDPOINTS, AGENT_LABELS, DASHBOARD_AGENTS
  const label = agentLabel || agentName.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  safeAppendToConfig(agentName, label);

  // 5. Commit to GitHub (best-effort)
  let githubResult = { synced: false, reason: "no skill/code files" };
  if (skillFile && codeFile) {
    githubResult = await commitToGitHub(agentName, skillFile.content, codeFile.content);
  }

  console.log(`[DEPLOY] New agent fully deployed: ${agentName} — ${written.length} files, config updated`);

  return {
    deployed: true,
    agent: agentName,
    files_written: written,
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
  "public/css/agents/",
];

// Hard-blocked files — the builder can NEVER write to these under any circumstances
const BLOCKED_FILES = new Set([
  "public/css/dashboard.css",
  "public/css/variables.css",
  "public/css/reset.css",
  "public/css/components.css",
  "public/css/hub.css",
  "public/css/mobile.css",
  "public/index.html",
  "public/js/dashboards/dashboard-shell.js",
  "public/js/config.js",
  "src/index.js",
  "src/tools/deploy-tools.js",
  "src/skills/master-agent.md",
  "src/skills/improvement-agent.md",
]);

function isPathAllowed(filePath) {
  if (BLOCKED_FILES.has(filePath)) {
    console.log(`[DEPLOY] HARD-BLOCKED: ${filePath} is a protected system file`);
    return false;
  }
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

// Protected CSS files — hashed before/after to detect unauthorized modification
const PROTECTED_CSS = [
  "public/css/dashboard.css", "public/css/variables.css", "public/css/reset.css",
  "public/css/components.css", "public/css/hub.css", "public/css/mobile.css",
];

function hashFile(relativePath) {
  const fullPath = join(PROJECT_ROOT, relativePath);
  if (!existsSync(fullPath)) return null;
  return createHash("sha256").update(readFileSync(fullPath, "utf8")).digest("hex");
}

/**
 * Safe enhancement deployment with rollback on test failure.
 * 1. Backup originals
 * 1.5 Snapshot protected CSS hashes
 * 2. Write new files
 * 2.5 Verify protected CSS unchanged (rollback if violated)
 * 3. Run tests
 * 4. If tests fail: restore originals + revert GitHub
 * 5. If tests pass: commit to GitHub, done
 */
export async function deployEnhancementSafe(agentName, files) {
  // 1. Backup
  const allowedFiles = files.filter(f => isPathAllowed(f.path));
  const backup = backupFiles(allowedFiles);
  console.log(`[SAFE-DEPLOY] Backed up ${Object.keys(backup).length} files for ${agentName}`);

  // 1.5 Snapshot protected CSS hashes BEFORE writing
  const preHashes = {};
  for (const f of PROTECTED_CSS) { preHashes[f] = hashFile(f); }

  // 2. Write new files to disk
  const written = writeEnhancementFiles(allowedFiles);
  console.log(`[SAFE-DEPLOY] Wrote ${written.length} files for ${agentName}`);

  // 2.5 CSS integrity check — protected files must not have changed
  for (const [f, hash] of Object.entries(preHashes)) {
    if (!hash) continue; // file didn't exist before
    const postHash = hashFile(f);
    if (postHash !== hash) {
      console.log(`[SAFE-DEPLOY] CSS INTEGRITY VIOLATION: ${f} was modified — rolling back`);
      restoreFiles(backup);
      return {
        deployed: false, mode: "enhance", agent: agentName, rolled_back: true,
        reason: `CSS integrity violation: ${f} was modified by the enhancement`,
      };
    }
  }
  console.log(`[SAFE-DEPLOY] CSS integrity check passed — protected files unchanged`);

  // 3. Run baseline tests BEFORE enhancement is active (restore, test, re-write)
  //    This captures pre-existing failures so we only roll back on NEW failures.
  let baselineFailures = 0;
  try {
    // Temporarily restore originals to get baseline
    restoreFiles(backup);
    const PORT_B = process.env.PORT || 5000;
    const baseResp = await fetch(`http://localhost:${PORT_B}/test/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (baseResp.ok) {
      const baseData = await baseResp.json();
      baselineFailures = baseData.failed || 0;
      console.log(`[SAFE-DEPLOY] Baseline: ${baseData.passed || 0} passed, ${baselineFailures} failed`);
    }
    // Re-write the enhancement files
    writeEnhancementFiles(allowedFiles);
  } catch (e) {
    console.log(`[SAFE-DEPLOY] Baseline test error (proceeding): ${e.message}`);
    // Re-write regardless
    writeEnhancementFiles(allowedFiles);
  }

  // 4. Run tests with enhancement applied
  let testsPassed = false;
  let testOutput = "";
  let postFailures = 0;
  try {
    const PORT = process.env.PORT || 5000;
    const testResp = await fetch(`http://localhost:${PORT}/test/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (testResp.ok) {
      const testData = await testResp.json();
      postFailures = testData.failed || 0;
      // Only fail if NEW failures appeared (more failures than baseline)
      testsPassed = postFailures <= baselineFailures;
      testOutput = `${testData.passed || 0} passed, ${postFailures} failed (baseline: ${baselineFailures})`;
      console.log(`[SAFE-DEPLOY] Post-enhancement tests: ${testOutput}`);
    } else {
      testOutput = `Test endpoint returned ${testResp.status}`;
      console.log(`[SAFE-DEPLOY] Test endpoint error: ${testResp.status}`);
    }
  } catch (e) {
    testOutput = `Test run failed: ${e.message}`;
    console.log(`[SAFE-DEPLOY] Test run error: ${e.message}`);
  }

  // 5. If NEW tests failed: ROLLBACK
  if (!testsPassed) {
    console.log(`[SAFE-DEPLOY] NEW TESTS FAILED — rolling back ${agentName} (${postFailures} failures vs ${baselineFailures} baseline)`);

    const restoreResult = restoreFiles(backup);
    console.log(`[SAFE-DEPLOY] Restored ${restoreResult.length} files from backup`);

    return {
      deployed: false,
      mode: "enhance",
      agent: agentName,
      rolled_back: true,
      reason: `New test failures after enhancement: ${testOutput}`,
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

// ── Safe config append (for new agent builds) ─────────────────────────────────

/**
 * Safely append a new agent to config.js maps without rewriting existing entries.
 * Used by BUILD mode only — the builder Claude never touches config.js.
 */
export function safeAppendToConfig(agentName, label) {
  const configPath = join(PROJECT_ROOT, "public/js/config.js");
  if (!existsSync(configPath)) {
    console.log(`[CONFIG] config.js not found — skipping`);
    return false;
  }
  let content = readFileSync(configPath, "utf8");

  // Skip if already registered
  if (content.includes(`'${agentName}'`)) {
    console.log(`[CONFIG] ${agentName} already in config.js — skipping`);
    return false;
  }

  // Append to AGENT_ENDPOINTS — find last entry line and add after it
  content = content.replace(
    /(var AGENT_ENDPOINTS\s*=\s*\{[\s\S]*?)((\n\s*\};))/m,
    (_, before, closing) => {
      // Remove trailing whitespace/newlines before closing
      const trimmed = before.replace(/[\s,]*$/, '');
      return `${trimmed},\n  '${agentName}': '/agents/${agentName}'${closing}`;
    }
  );

  // Append to AGENT_LABELS
  content = content.replace(
    /(var AGENT_LABELS\s*=\s*\{[\s\S]*?)((\n\s*\};))/m,
    (_, before, closing) => {
      const trimmed = before.replace(/[\s,]*$/, '');
      return `${trimmed},\n  '${agentName}': '${label}'${closing}`;
    }
  );

  // Append to DASHBOARD_AGENTS
  content = content.replace(
    /(var DASHBOARD_AGENTS\s*=\s*\{[\s\S]*?)((\n\s*\};))/m,
    (_, before, closing) => {
      const trimmed = before.replace(/[\s,]*$/, '');
      return `${trimmed},\n  '${agentName}': true${closing}`;
    }
  );

  writeFileSync(configPath, content, "utf8");
  console.log(`[CONFIG] Appended ${agentName} to config.js`);
  return true;
}

/**
 * Safely append a new renderer to dashboard-shell.js renderers map.
 */
export function safeAppendToDashboardShell(agentName, renderFunctionName) {
  const shellPath = join(PROJECT_ROOT, "public/js/dashboards/dashboard-shell.js");
  if (!existsSync(shellPath)) {
    console.log(`[CONFIG] dashboard-shell.js not found — skipping`);
    return false;
  }
  let content = readFileSync(shellPath, "utf8");

  if (content.includes(`'${agentName}'`)) {
    console.log(`[CONFIG] ${agentName} already in dashboard-shell.js — skipping`);
    return false;
  }

  // Find the last entry in the renderers map and add after it
  content = content.replace(
    /('italy2026':\s*renderItaly2026Dashboard)/,
    `$1,\n    '${agentName}': ${renderFunctionName}`
  );

  writeFileSync(shellPath, content, "utf8");
  console.log(`[CONFIG] Appended ${agentName} renderer to dashboard-shell.js`);
  return true;
}

/**
 * Safely append a script tag for a new dashboard JS file to index.html.
 */
export function safeAppendScriptTag(dashboardFileName) {
  const htmlPath = join(PROJECT_ROOT, "public/index.html");
  if (!existsSync(htmlPath)) {
    console.log(`[CONFIG] index.html not found — skipping`);
    return false;
  }
  let content = readFileSync(htmlPath, "utf8");

  const scriptTag = `<script src="/js/dashboards/${dashboardFileName}"></script>`;
  if (content.includes(scriptTag)) {
    console.log(`[CONFIG] Script tag for ${dashboardFileName} already in index.html — skipping`);
    return false;
  }

  // Insert before the closing </head> or after the last dashboard script tag
  content = content.replace(
    /(<script src="\/js\/dashboards\/dashboard-shell\.js"><\/script>)/,
    `$1\n  ${scriptTag}`
  );

  writeFileSync(htmlPath, content, "utf8");
  console.log(`[CONFIG] Appended script tag for ${dashboardFileName} to index.html`);
  return true;
}

// ── Graceful restart ──────────────────────────────────────────────────────────

/**
 * Trigger a graceful server restart with maintenance notice.
 * Sets a flag in the DB, then exits the process after a short delay.
 * Replit auto-restarts the process on exit(0).
 */
export async function triggerGracefulRestart(agentName, reason) {
  console.log(`[RESTART] Initiating graceful restart: ${reason}`);

  try {
    const { ensureDB } = await import("../db.js");
    const rawDb = await ensureDB();
    await rawDb.set("system:maintenance", JSON.stringify({
      active: true,
      reason: `Deploying: ${agentName}`,
      started_at: new Date().toISOString(),
    }));
    console.log(`[RESTART] Maintenance flag set`);
  } catch (e) {
    console.log(`[RESTART] Could not set maintenance flag: ${e.message}`);
  }

  if (process.env.LOCAL_DEV === "true") {
    // In local dev, don't exit — just log and clear maintenance flag
    console.log(`[RESTART] LOCAL_DEV mode — skipping process.exit, agent deployed in-place`);
    try {
      const { ensureDB } = await import("../db.js");
      const rawDb = await ensureDB();
      await rawDb.set("system:maintenance", null);
    } catch (e) {}
    return;
  }

  // Delay to let the current HTTP response finish
  setTimeout(() => {
    console.log(`[RESTART] process.exit(0) — Replit will auto-restart`);
    process.exit(0);
  }, 2000);
}
