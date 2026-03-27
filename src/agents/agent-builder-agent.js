import Anthropic from "@anthropic-ai/sdk";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { v4 as uuidv4 } from "uuid";
import * as db from "../db.js";
import { deployAgent, deployEnhancementSafe } from "../tools/deploy-tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "../..");
const skill = readFileSync(
  join(__dirname, "../skills/agent-builder-agent.md"),
  "utf8"
);
const skillTemplate = readFileSync(
  join(__dirname, "../skills/agent-builder-templates/skill-template.md"),
  "utf8"
);
const codeTemplate = readFileSync(
  join(__dirname, "../skills/agent-builder-templates/code-template.js"),
  "utf8"
);

const client = new Anthropic();

// ── File reading for enhance mode ─────────────────────────────────────────────

function safeReadFile(relativePath) {
  try {
    const fullPath = join(PROJECT_ROOT, relativePath);
    if (existsSync(fullPath)) {
      return readFileSync(fullPath, "utf8");
    }
  } catch {}
  return null;
}

function readExistingAgentFiles(agentName) {
  const files = {};

  // Agent code and skill
  files.skill = safeReadFile(`src/skills/${agentName}.md`);
  files.code = safeReadFile(`src/agents/${agentName}.js`);

  // Dashboard — try agent name, then common short names
  const dashboardNames = [
    agentName,
    agentName.replace(/-agent$/, ""),
    agentName.replace(/-agent$/, "").replace(/-/g, ""),
  ];
  for (const name of dashboardNames) {
    const content = safeReadFile(`public/js/dashboards/${name}.js`);
    if (content) {
      files.dashboard = content;
      files.dashboardPath = `public/js/dashboards/${name}.js`;
      break;
    }
  }

  // Agent-specific CSS (NOT shared dashboard.css — that's blocked)
  files.agentCss = safeReadFile(`public/css/agents/${agentName}.css`);

  return files;
}

// ── System prompt builders ────────────────────────────────────────────────────

function buildSystemPrompt(buildBrief, context) {
  return `${skill}

Here is the skill template you must use — fill in the [BRACKETED] fields:
\`\`\`
${skillTemplate}
\`\`\`

Here is the code template you must use — fill in the [BRACKETED] fields:
\`\`\`
${codeTemplate}
\`\`\`

Build brief received:
${JSON.stringify(buildBrief, null, 2)}

Context:
${JSON.stringify(context, null, 2)}`;
}

function buildEnhanceSystemPrompt(enhanceBrief, existingFiles, context) {
  let fileContext = "\n\n## EXISTING FILES (current state)\n\n";

  if (existingFiles.skill) {
    fileContext += `### src/skills/${enhanceBrief.agent_name || "unknown"}.md\n\`\`\`markdown\n${existingFiles.skill}\n\`\`\`\n\n`;
  }
  if (existingFiles.code) {
    fileContext += `### src/agents/${enhanceBrief.agent_name || "unknown"}.js\n\`\`\`javascript\n${existingFiles.code}\n\`\`\`\n\n`;
  }
  if (existingFiles.dashboard) {
    fileContext += `### ${existingFiles.dashboardPath}\n\`\`\`javascript\n${existingFiles.dashboard}\n\`\`\`\n\n`;
  }
  if (existingFiles.agentCss) {
    fileContext += `### public/css/agents/${enhanceBrief.agent_name || "unknown"}.css\n\`\`\`css\n${existingFiles.agentCss}\n\`\`\`\n\n`;
  }

  const agentName = enhanceBrief.agent_name || "unknown";

  return `${skill}
${fileContext}

## CSS RULES (MANDATORY — violations cause automatic rollback):
- All new CSS MUST go to public/css/agents/${agentName}.css (auto-loaded by dashboard system)
- NEVER write to public/css/dashboard.css or ANY shared CSS file — this is HARD-BLOCKED
- NEVER write to public/js/config.js or public/js/dashboards/dashboard-shell.js — the deploy pipeline handles these
- NEVER write to public/index.html or src/index.js
- Use existing shared classes: .dash-header, .dash-title, .dash-subtitle, .dash-card, .dash-card-body, .dash-card-title, .dash-card-meta, .dash-btn, .dash-actions, .dash-section-label, .dash-loading, .dash-empty, .dash-chat, .dash-tabs, .dash-tab, .dash-tab-content
- Prefix any custom classes with the agent name: e.g., .${agentName}-positions-table

## DASHBOARD RULES (MANDATORY):
- When enhancing a dashboard, output ONLY the additions — new functions, modified functions
- Do NOT output the entire dashboard file content — only output the changed/added parts
- For new sections: write a new function and clearly show where it gets called from in the existing render function
- Mark additions with ===FILE: path=== format

## ALLOWED FILE PATHS:
- src/agents/${agentName}.js (agent logic)
- src/skills/${agentName}.md (agent skill/prompt)
- public/js/dashboards/*.js (dashboard rendering — additions only for existing files)
- public/css/agents/${agentName}.css (agent-specific CSS — new file OK)

MODE: ENHANCE (modifying an existing agent, not building a new one)

Enhance brief received:
${JSON.stringify(enhanceBrief, null, 2)}

Context:
${JSON.stringify(context, null, 2)}`;
}

// ── BUILD mode (existing) ─────────────────────────────────────────────────────

/**
 * Start a new build session — Phase 1.
 * Returns a session_id the caller uses to continue the pipeline.
 */
export async function startBuild(buildBrief, context = {}) {
  const sessionId = uuidv4();
  const systemPrompt = buildSystemPrompt(buildBrief, context);

  const userMessage = `Execute the 4-phase Agent Builder pipeline for this build brief.
Start with Phase 1 — write the skill file and output it for review.
Label your output clearly: SKILL FILE — READY FOR REVIEW
Do NOT proceed to Phase 2 until you receive explicit approval.`;

  const messages = [{ role: "user", content: userMessage }];

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: systemPrompt,
    messages,
  });

  const output = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();

  const session = {
    id: sessionId,
    mode: "build",
    build_brief: buildBrief,
    context,
    system_prompt: systemPrompt,
    messages: [
      ...messages,
      { role: "assistant", content: output },
    ],
    phase: detectPhase(output),
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  await db.set(`build-session:${sessionId}`, session);

  return {
    agent: "agent-builder-agent",
    session_id: sessionId,
    phase: session.phase,
    output,
    requires_approval: true,
    approval_reason: "Review the skill file before proceeding to Phase 2",
  };
}

// ── ENHANCE mode (new) ───────────────────────────────────────────────────────

/**
 * Start an enhance session — reads existing agent files, starts Phase 1.
 */
export async function startEnhance(enhanceBrief, context = {}) {
  const sessionId = uuidv4();
  const agentName = enhanceBrief.agent_name || enhanceBrief.agent_to_enhance || "";

  if (!agentName) {
    return {
      agent: "agent-builder-agent",
      output: "Enhancement failed: no agent name specified in enhance brief.",
      success: false,
    };
  }

  // Read all existing files for this agent
  const existingFiles = readExistingAgentFiles(agentName);
  const systemPrompt = buildEnhanceSystemPrompt(enhanceBrief, existingFiles, context);

  const userMessage = `Execute the FULL ENHANCE pipeline for this enhance brief in a SINGLE response.

You are in ENHANCE mode — you are modifying an existing agent, not building a new one.

IMPORTANT: Complete ALL phases in this single response:
1. Read the existing files provided in your context
2. Plan your changes
3. Generate ALL modified files with complete content
4. Include a DEPLOYMENT section

For EACH file you modify or create, output it in this exact format:

===FILE: relative/path/to/file===
(complete file content here)
===END FILE===

After all files, output: DEPLOYMENT COMPLETE

Do NOT stop for review. Do NOT wait for approval. Run the full pipeline now.
The rollback safety net will automatically revert if anything breaks.`;

  const messages = [{ role: "user", content: userMessage }];

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 16384,
    system: systemPrompt,
    messages,
  });

  const output = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();

  const session = {
    id: sessionId,
    mode: "enhance",
    enhance_brief: enhanceBrief,
    agent_name: agentName,
    existing_files: Object.keys(existingFiles).filter(k => existingFiles[k]),
    context,
    system_prompt: systemPrompt,
    messages: [
      ...messages,
      { role: "assistant", content: output },
    ],
    phase: detectPhase(output),
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  // Extract files and store as pending — wait for human approval before deploying
  if (session.phase === "deployed") {
    const files = extractEnhancementFiles(session.messages);
    if (files.length > 0) {
      session.phase = "awaiting_approval";
      const pendingId = sessionId;
      await db.set(`builder:pending:${pendingId}`, {
        id: pendingId,
        agent: session.agent_name,
        mode: "enhance",
        files: files.map(f => ({ path: f.path, preview: f.content.substring(0, 500), size: f.content.length })),
        full_files: files,
        created_at: new Date().toISOString(),
        status: "awaiting_approval",
      });
      console.log(`[BUILDER] Enhancement ready for approval: ${session.agent_name} — ${files.length} files — session ${pendingId}`);
    } else {
      console.log(`[BUILDER] WARNING: No files extracted from enhance output`);
      session.deploy_result = { deployed: false, reason: "No files extracted" };
    }
  }

  await db.set(`build-session:${sessionId}`, session);

  return {
    agent: "agent-builder-agent",
    session_id: sessionId,
    mode: "enhance",
    phase: session.phase,
    output,
    deploy_result: session.deploy_result || null,
    requires_approval: session.phase === "awaiting_approval",
  };
}

// ── Continue session (works for both build and enhance) ───────────────────────

/**
 * Continue an existing build/enhance session — send an approval or instruction,
 * get the next phase output.
 */
export async function continueBuild(sessionId, userMessage) {
  const session = await db.get(`build-session:${sessionId}`);
  if (!session) {
    throw new Error(`Build session ${sessionId} not found`);
  }

  session.messages.push({ role: "user", content: userMessage });

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    system: session.system_prompt,
    messages: session.messages,
  });

  const output = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();

  session.messages.push({ role: "assistant", content: output });
  session.phase = detectPhase(output);
  session.updated = new Date().toISOString();

  // ── DEPLOYMENT ──
  if (session.phase === "deployed") {
    try {
      if (session.mode === "enhance") {
        // Enhance mode: extract files, backup originals, deploy, test, rollback if broken
        const files = extractEnhancementFiles(session.messages);
        if (files.length > 0) {
          const deployResult = await deployEnhancementSafe(session.agent_name, files);
          session.deploy_result = deployResult;

          if (deployResult.rolled_back) {
            // Tests failed — files already restored, mark session as failed
            session.phase = "rollback";
            console.log(`[BUILDER] ROLLED BACK: ${session.agent_name} — tests failed, originals restored`);
          } else {
            console.log(`[BUILDER] ENHANCED: ${session.agent_name} — ${files.length} files written, tests passed`);
          }

          // Log execution
          try {
            const { logExecution } = await import("../tools/approval-tools.js");
            await logExecution({
              source: "agent-builder",
              proposal_id: sessionId,
              action_type: "agent_enhanced",
              change_type: "enhancement",
              description: `Enhanced ${session.agent_name}: ${files.map(f => f.path).join(", ")}`,
              success: true,
            });
          } catch {}
        } else {
          console.log(`[BUILDER] WARNING: Could not extract files from enhance session`);
          session.deploy_result = { deployed: false, reason: "Could not extract files from conversation" };
        }
      } else {
        // Build mode: original new agent deployment
        const extracted = extractArtifacts(session.messages);
        if (extracted.agentName && extracted.skillContent && extracted.codeContent) {
          const registryEntry = {
            name: extracted.agentName,
            domain: extracted.domain || "General",
            status: "Active",
            purpose: `Auto-built agent: ${extracted.agentName}`,
            endpoints: [`/agents/${extracted.agentName}`],
            created_at: new Date().toISOString(),
          };

          const deployResult = await deployAgent(
            extracted.agentName,
            extracted.skillContent,
            extracted.codeContent,
            registryEntry
          );

          session.deploy_result = deployResult;
          console.log(`[BUILDER] DEPLOYED: ${extracted.agentName} — files written, registered, GitHub synced`);

          try {
            const { logExecution } = await import("../tools/approval-tools.js");
            await logExecution({
              source: "agent-builder",
              proposal_id: sessionId,
              action_type: "agent_deployed",
              change_type: "new_agent",
              description: `Deployed new agent: ${extracted.agentName} — skill + code written, registered, route live`,
              success: true,
            });
          } catch {}
        } else {
          console.log(`[BUILDER] WARNING: Could not extract artifacts from session. Agent name: ${extracted.agentName}, skill: ${!!extracted.skillContent}, code: ${!!extracted.codeContent}`);
          session.deploy_result = { deployed: false, reason: "Could not extract skill/code from conversation" };
        }
      }

      // Hot-reload for both modes
      try {
        const PORT = process.env.PORT || 5000;
        await fetch(`http://localhost:${PORT}/system/agent-loaded`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent: session.agent_name || "unknown" }),
        });
      } catch {}
    } catch (e) {
      console.log(`[BUILDER] DEPLOY ERROR: ${e.message}`);
      session.deploy_result = { deployed: false, error: e.message };
    }
  }

  await db.set(`build-session:${sessionId}`, session);

  let approvalReason = null;
  if (session.phase === "phase-1-review" || session.phase === "enhance-plan-review") {
    approvalReason = session.mode === "enhance"
      ? "Review the enhancement plan before proceeding"
      : "Review the skill file before proceeding to Phase 2";
  } else if (session.phase === "phase-2-review" || session.phase === "enhance-files-review") {
    approvalReason = session.mode === "enhance"
      ? "Review the modified files before validation"
      : "Review the agent code before proceeding to validation";
  } else if (session.phase === "validated") {
    approvalReason = session.mode === "enhance"
      ? "Validation passed — approve to deploy the enhancement"
      : "Validation passed — approve to deploy the agent";
  }

  return {
    agent: "agent-builder-agent",
    session_id: sessionId,
    mode: session.mode || "build",
    phase: session.phase,
    output,
    deploy_result: session.deploy_result || null,
    requires_approval: session.phase !== "deployed" && session.phase !== "validation-failed" && session.phase !== "rollback",
    approval_reason: approvalReason,
  };
}

/**
 * Legacy single-call entry point — starts a new build.
 * Kept for backward compatibility with POST /agents/builder.
 */
export async function runAgentBuilder(buildBrief, context = {}) {
  // Auto-detect: if context contains enhance_brief, start enhance mode
  if (context.enhance_brief || buildBrief.mode === "enhance" || buildBrief.agent_to_enhance) {
    const enhanceBrief = context.enhance_brief || buildBrief;
    return startEnhance(enhanceBrief, context);
  }
  return startBuild(buildBrief, context);
}

// ── Artifact extraction ───────────────────────────────────────────────────────

/**
 * Extract skill file content, code content, and agent name from BUILD conversation.
 */
function extractArtifacts(messages) {
  let skillContent = null;
  let codeContent = null;
  let agentName = null;
  let domain = null;

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const text = typeof msg.content === "string" ? msg.content : "";

    if (!agentName) {
      const nameMatch = text.match(/Agent:\s+([\w-]+)/i) ||
        text.match(/agent_name.*?["']?([\w-]+(?:-agent)?)["']?/i) ||
        text.match(/Code file:\s+src\/agents\/([\w-]+)\.js/i) ||
        text.match(/Route:\s+POST \/agents\/([\w-]+)/i);
      if (nameMatch) agentName = nameMatch[1];
    }

    if (!domain) {
      const domainMatch = text.match(/Domain[:\s]+(\w[\w\s]*\w)/i);
      if (domainMatch) domain = domainMatch[1].trim();
    }

    if (!skillContent && text.includes("SKILL FILE")) {
      const mdMatch = text.match(/```(?:markdown)?\s*\n([\s\S]*?)```/);
      if (mdMatch) skillContent = mdMatch[1].trim();
    }

    if (!codeContent && text.includes("AGENT CODE")) {
      const jsMatch = text.match(/```(?:javascript|js)?\s*\n([\s\S]*?)```/);
      if (jsMatch) codeContent = jsMatch[1].trim();
    }
  }

  return { agentName, skillContent, codeContent, domain };
}

/**
 * Extract all modified/new files from ENHANCE conversation.
 * Looks for MODIFIED FILE: path and NEW FILE: path markers followed by fenced code blocks.
 */
function extractEnhancementFiles(messages) {
  const files = [];
  const seen = new Set();

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const text = typeof msg.content === "string" ? msg.content : "";

    // Match MODIFIED FILE: path and NEW FILE: path (code block format)
    const filePattern = /(?:MODIFIED|NEW) FILE:\s*([^\n]+)\s*\n```(?:\w*)\s*\n([\s\S]*?)```/g;
    let match;
    while ((match = filePattern.exec(text)) !== null) {
      const filePath = match[1].trim();
      const content = match[2].trim();
      if (filePath && content && !seen.has(filePath)) {
        seen.add(filePath);
        files.push({ path: filePath, content });
      }
    }

    // Also match ===FILE: path=== ... ===END FILE=== format
    const altPattern = /===FILE:\s*([^\n=]+)===\s*\n([\s\S]*?)===END FILE===/g;
    while ((match = altPattern.exec(text)) !== null) {
      const filePath = match[1].trim();
      const content = match[2].trim();
      if (filePath && content && !seen.has(filePath)) {
        seen.add(filePath);
        files.push({ path: filePath, content });
      }
    }
  }

  return files;
}

function detectPhase(output) {
  if (output.includes("DEPLOYMENT COMPLETE")) return "deployed";
  if (output.includes("VALIDATION PASSED")) return "validated";
  if (output.includes("VALIDATION FAILED")) return "validation-failed";
  if (output.includes("ALL FILES — READY FOR REVIEW")) return "enhance-files-review";
  if (output.includes("AGENT CODE — READY FOR REVIEW")) return "phase-2-review";
  if (output.includes("ENHANCE PLAN — READY FOR REVIEW")) return "enhance-plan-review";
  if (output.includes("SKILL FILE — READY FOR REVIEW")) return "phase-1-review";
  return "in-progress";
}
