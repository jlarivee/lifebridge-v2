# LifeBridge Master Build Log

**Project:** LifeBridge Autonomous Agent Operating System  
**Owner:** Josh Larivee  
**Started:** March 22, 2026  
**Current version:** v2.3 (live)  
**Repo v1:** github.com/jlarivee/lifebridge  
**Repo v2:** github.com/jlarivee/lifebridge-v2  

---

## What LifeBridge Is

LifeBridge is a hub-and-spoke autonomous agent operating system. The master agent sits at the center — it receives every request, reasons through it, classifies the domain, checks the capability registry, and routes to the right specialized agent. If no capable agent exists, it generates a build brief. It never executes tasks directly.

The system is designed to get smarter over time: every request is logged, every rejection captures feedback, and a separate improvement agent analyzes patterns daily and proposes changes to the master agent's own instructions. Nothing changes without human approval.

---

## Core Principles (Non-Negotiable)

- **Hub and spoke.** Master agent orchestrates. Spoke agents act.
- **Ask when uncertain.** One precise clarifying question. Never guess.
- **Build vs. reuse.** Check the registry on every request before building anything new.
- **Human in the loop.** Flag anything consequential. Never assume approval.
- **Route, don't execute.** The master agent is an orchestration intelligence, not a doer.
- **Clean slate.** LifeBridge shares nothing with JoshOS. No code, no patterns, no assumptions carried over.
- **No memory between sessions without a registry.** Always re-establish context from input.

---

## Architecture

```
Request (natural language or structured)
        ↓
Master Agent (orchestrator)
  - Runs reasoning chain (Goal → Constraints → Capabilities → Options → Best path → Gaps)
  - Self-reports confidence score (0-100)
  - Checks capability registry
  - Checks global context
  - Routes to spoke agent OR generates build brief
        ↓
Spoke Agent (specialized, scoped tools)
        ↓
Outcome logged → Improvement agent analyzes → Proposals surface → Human approves → System evolves
```

### State files (Replit Database in v2)

| Key | Contents |
|---|---|
| `registry` | agents, connectors, domain_signals, claude_capabilities |
| `context` | preferences, constraints, learned_patterns |
| `request:{uuid}` | one entry per routed request |
| `improvement:{uuid}` | one entry per improvement proposal |

### Domains
Work · Personal Business · Personal Life · System

The master agent learns domain signals by asking — never from hardcoded assumptions. Every clarification is logged to the registry as a training event.

---

## Version History

### v1.0 — Master Agent Runtime (Flask)
**What was built:**
- Flask app on Replit with POST /route endpoint
- Master agent system prompt loaded from system-prompt.txt
- Registry state injected into every API call
- Minimal web UI at GET / — text input, monospace routing package display
- registry.json (empty, schema defined)

**Stack:** Python, Flask, Anthropic API  
**State:** Flat JSON files  
**Repo:** github.com/jlarivee/lifebridge  

---

### v1.1 — Reasoning + Capability Awareness
**What was built:**
- Reasoning chain added to system prompt (Goal / Constraints / Capabilities / Options / Best path / Gaps)
- Claude-native capabilities section added to system prompt
- Connectors registry section added to system prompt
- registry.json expanded with `connectors` and `claude_capabilities` arrays
- Registry state injected into every /route call at runtime
- UI updated: reasoning block parsed from response, shown via "Show reasoning" toggle (hidden by default)

---

### v1.2 — Improvement Agent
**What was built:**
- request-log.json — every /route call appends a structured entry
- improvement_agent.py — separate module, reads all state, calls Claude, proposes changes
- Four endpoints: /improve/run, /improve/approve, /improve/reject, /improve/history
- Approval flow: approve edits system-prompt.txt or registry.json and reloads live prompt
- Reject: marks change, no file touch
- Daily scheduler: background thread runs improvement cycle at midnight UTC
- Improvement UI tab: run button, pending proposals with per-change approve/reject cards, side-by-side diff, history panel
- improvement-history.json

---

### v1.3 — Feedback Capture + Confidence + Context
**What was built:**
- POST /route/feedback endpoint — captures outcome (accepted/rejected) and feedback text
- [Looks good] / [Something's wrong] buttons in UI after every response
- "Something's wrong" expands inline text field — feedback written to request log
- Confidence scoring: master agent self-reports 0-100 in reasoning chain
- Confidence gates: 90+ normal, 70-89 auto-expand reasoning, below 70 warning banner, below 50 clarification required (no routing package)
- Confidence parsed from response, stored in request log, returned in /route JSON response
- context.json created: { preferences, constraints, learned_patterns }
- context.json injected into every /route call alongside registry
- Improvement agent updated: reads context, can propose "Context addition" type
- Approve endpoint handles Context addition → writes to context.json
- Global context viewer in Improvement UI tab (read only)
- Request log schema updated: outcome, feedback, confidence fields added

---

### v1.4 — GitHub Sync (designed, not built — superseded by v2)
**What was designed:**
- github_sync.py module: commit_state_file(filename, reason)
- Auto-commit on every state-changing operation
- Daily full sync at midnight UTC
- Sync status indicator in UI footer
- GET /sync/status endpoint
- sync-status.json

**Decision:** Superseded by v2 rebuild. Replit Database makes this unnecessary — state is persistent natively.

---

### v2.0 — Rebuild on Claude Agent SDK
**Why rebuild:**
- Flask was a web app pretending to be an agent runtime
- Claude Agent SDK is the native runtime — orchestrator, sub-agents, tools, skills all built in
- Replit Database replaces flat JSON files — persistent, reliable, no sync needed
- UI issues in v1 were a symptom of the wrong architecture

**Stack:** JavaScript, Anthropic SDK (@anthropic-ai/sdk), Replit Database (@replit/database), Express, node-cron
**Repo:** github.com/jlarivee/lifebridge-v2
**Deployment:** Reserved VM (always-on, event-driven)
**Status:** Live

**Project structure:**
```
src/
  agents/
    master-agent.js                  ← orchestrator, loads master-agent skill
    improvement-agent.js             ← separate process, reads logs, proposes changes
    life-sciences-account-agent.js   ← first spoke agent (v2.1)
  skills/
    master-agent.md                  ← full system prompt
    improvement-agent.md             ← improvement agent instructions
    life-sciences-account-agent.md   ← account intelligence skill (v2.1)
  tools/
    registry-tools.js    ← readRegistry, writeRegistry
    context-tools.js     ← readContext, writeContext
    log-tools.js         ← logRequest, logFeedback, readRecentLog
    approval-tools.js    ← approveChange, rejectChange
  db.js                  ← Replit Database wrapper
  index.js               ← Express server, all routes, startup, cron
public/
  index.html             ← command center UI
.replit                  ← run = "node src/index.js"
replit.nix               ← nodejs_20
package.json             ← all dependencies
```

**What carries over from v1:**
- system-prompt.txt → src/skills/master-agent.md (verbatim)
- All state schemas (registry, context, request log, improvement history)
- Improvement agent logic and prompt structure
- Confidence scoring system
- Feedback capture system
- UI design and behavior

**What changes:**
- Runtime: Flask → Anthropic SDK + Express
- State: flat JSON files → Replit Database
- Language: Python → JavaScript
- Deployment: always-on Reserved VM from day one

---

### v2.1 — Administration Agent Suite + Persistence Fixes
**What was built:**
- Agent Builder Agent fixed — now actually deploys real files to disk, registers agents in Replit Database, creates live Express routes
- Agent persistence fixed — server bootstraps from registry on every startup, all active agents get health endpoints registered dynamically
- Ideas system added — POST/GET/PUT/DELETE /ideas, send to master agent, full persistence in Replit Database
- Test Agent — daily test suites per agent, baseline capture, confidence trend tracking, dead agent detector, full UI tab
- Registry Integrity Agent — weekly + on-deploy integrity scans, orphan detection, ghost entry detection, health endpoints, full UI tab
- System Health tab added to hub UI
- Tests tab added to hub UI

**Life Sciences Account Intelligence Agent:**
- 200-line skill file with full account portfolio, Project Helix framework, competitive landscape, five output formats, web search research protocol
- Auto-registration on startup with 20+ trigger patterns
- Master agent routing instruction: pharma/payer account work routes to this agent

**Automatic Spoke Agent Execution in UI:**
- UI parses "Route to:" from routing package, calls matching agent endpoint automatically
- Generic AGENT_ROUTES map + dynamic fallback for deployed agents
- Animated loading, REQUIRES APPROVAL banner, feedback after agent output

**Slab Inventory Tracker Agent:**
- Tracks Three Rivers Slab inventory: species, dimensions, cut date, asking price, status, yard location
- Pricing guidelines by species ($/board foot), aging alerts at 60 days
- Listing generation for Facebook Marketplace / Instagram

**Agents now active:** 5
- life-sciences-account-agent (Work)
- agent-builder-agent (System)
- slab-inventory-tracker-agent (Personal Business)
- test-agent (System)
- registry-integrity-agent (System)

---

### v2.2 — Administration Agent Suite Verified + Test Pipeline Live
**What was built:**
- Intelligence Update Agent fully operational — 6 sources scanning daily, 33 findings captured on first run, proposals surfacing with Approve/Reject UI
- Test Agent running real suites — 8 passed, 0 failed on first full run, baselines captured for all agents
- Registry Integrity Agent confirmed — 6 agents healthy, 0 issues
- Test cases fixed — replaced natural language routing tests with endpoint-based tests for all agents
- POST /intelligence/sources endpoint added
- GET /intelligence/status endpoint added for lightweight health checks
- Duplicate registry entries cleaned — removed three-rivers-slab-inventory-agent ghost entry, removed professional-networking-agent pending entry
- slab-inventory-tracker-agent domain corrected to Personal Business
- Test Agent now auto-runs targeted suite on every agent deploy

**Test results as of v2.2:**
- Agents tested: 5
- Total cases: 8
- Passed: 8
- Failed: 0
- All baselines captured

**Intelligence Update Agent first scan results:**
- Sources scanned: 6 (all healthy)
- Total findings: 33
- Proposals surfaced: multiple, awaiting human review

**Agents now active:** 6
- life-sciences-account-agent (Work)
- agent-builder-agent (System)
- slab-inventory-tracker-agent (Personal Business)
- test-agent (System)
- registry-integrity-agent (System)
- intelligence-update-agent (System)

---

### v2.3 — Spoke Agents Operational + Test-Driven Build Process
**What was fixed:**
- POST /agents/{name} action endpoints built for all spoke agents
- slab-inventory-tracker-agent fully operational — adds inventory records, queries, aging detection all working end to end
- intelligence-update-agent fully operational — lists proposals, prioritizes approvals, filters by category
- Dynamic fallback handler added — every registered active agent can receive requests automatically
- Response format standardized — all agents return { agent, output, success, action_taken }
- "No output" UI bug identified, test cases added, fixed, verified

**Process change — Test-Driven Agent Building:**
- Test cases must be written BEFORE agent code
- Test Agent runs confirm FAIL before build starts
- Test Agent runs confirm PASS before build is declared complete
- Agent Builder Phase 4 rewritten with 8 mandatory steps
- No agent can be declared complete without passing Test Agent suite
- Every agent response must include { agent, output }

**Verified end-to-end in UI:**
- Novartis meeting prep — Life Sciences Account Agent ✅
- Top 3 accounts this quarter — Life Sciences Account Agent ✅
- Add slab to inventory — Slab Inventory Tracker Agent ✅
- Pending proposals — Intelligence Update Agent ✅
- Personal Life domain — Claude-native handled correctly ✅

---

## The Master Agent System Prompt (Current — v2.3)

Stored as src/skills/master-agent.md. Includes reasoning protocol with confidence scoring, Claude-native capabilities reference, connectors registry section, and explicit routing instruction for the life-sciences-account-agent. Full content lives in the skill file — not duplicated here to avoid drift.

---

## Capability Registry (Current State)

**Agents:**
| Agent | Domain | Status |
|---|---|---|
| life-sciences-account-agent | Work | Active |
| agent-builder-agent | System | Active |
| slab-inventory-tracker-agent | Personal Business | Active |
| test-agent | System | Active |
| registry-integrity-agent | System | Active |
| intelligence-update-agent | System | Active |

**Claude-native capabilities:** web_search, code_execution, file_reading, api_calls, artifact_creation, structured_reasoning, skill_invocation

**Connectors:** None registered yet

---

## Intelligence Stack (All 5 Layers)

```
1. INPUT         Natural language · JSON · Webhook · Scheduled trigger
2. REASONING     Goal → Constraints → Capabilities → Options → Best path → Gaps → Confidence
3. ACT           Route to agent · Approval gate · Build brief → Claude Code
4. LEARN         Request logged · Feedback captured · Context.json updated
5. EVOLVE        Improvement agent analyzes · Proposes changes · Human approves · Commit
```

---

## Daily Schedule

| Time (UTC) | Agent | Frequency |
|---|---|---|
| 5:00 AM Sunday | Registry Integrity Agent | Weekly |
| 6:00 AM | Intelligence Update Agent | Daily |
| 7:00 AM | Test Agent (full suite) | Daily |
| Midnight | Improvement Agent | Daily |
| On every deploy | Test Agent (targeted) + Registry Integrity Agent | Event |

---

## What Gets Built Next

### Completed — v2.0 verification ✅
### Completed — first spoke agent ✅
### Completed — administration agent suite ✅
### Completed — intelligence update agent ✅
### Completed — test pipeline verified (8/8 passing) ✅
### Completed — spoke agents operational + test-driven build process ✅

### Next priority
- Morning Briefing Agent — NEXT
  Daily summary: system health, intelligence findings, improvement proposals pending, test results, ideas queued
  Delivered every morning at 7:30 AM UTC
  Single structured briefing to start the day
- Three Rivers Slab workflows — pricing, aging alerts, inventory reports

### Future capabilities
- Connectors (Gmail, Calendar, Todoist, Google Drive) — spoke agents will need these
- Multi-turn conversation memory within a session
- Agent-to-agent delegation (spoke agent calls another spoke agent)
- Approval workflow with email notification

---

## Key Decisions Log

| Decision | Choice | Reason |
|---|---|---|
| Runtime | Replit (hosted, always-on) | Simple, no infra overhead |
| Language v1 | Python / Flask | Fast start |
| Language v2 | JavaScript / Claude Agent SDK | Native runtime fit |
| State v1 | Flat JSON files | Simple for MVP |
| State v2 | Replit Database | Persistent, no sync needed |
| GitHub sync | Not built (v1.4 skipped) | Replit DB made it unnecessary |
| Improvement agent | Separate process, proposals only | Master agent must not rewrite itself |
| Confidence gates | 90/70/50 thresholds | Graduated autonomy earned by track record |
| SDK rebuild | New repo lifebridge-v2 | Clean slate, v1 preserved as reference |
| JoshOS | Zero carry-over | LifeBridge is a clean-slate project |
| First spoke agent | Life Sciences Account Intelligence | Data-driven: Josh's most frequent request type is pharma account work |
| Agent auto-execution | UI calls spoke agent automatically after routing | Eliminates manual second step — routing + execution in one flow |
| Web search on every agent call | Account agent always searches before output | Prevents stale briefings — current signals are non-negotiable |
| Feedback after agent output | Buttons appear after spoke agent completes | User judges the final output, not the routing decision |
| GitHub ↔ Replit sync | Git panel Pull, not auto-deploy | Deliberate deployment — no accidental pushes to production |
| Agent health endpoints | Single dynamic route /agents/:name/health | Handles all agents without per-agent manual registration |
| Agent persistence | Bootstrap from registry on startup | Agents survive restarts without manual re-registration |
| Administration agents | Build order: Test → Integrity → Intelligence | Test first so other agents can be verified as they ship |
| Test-driven agent building | Tests first, build second | Caught "No output" bug class before it reaches production |
| Agent response standard | { agent, output, success, action_taken } | Required on all spoke agent responses for UI rendering |

---

## How to Use This Document

At the start of any new session in this Claude Project, reference this document.
It contains everything needed to resume work without re-reading the full conversation.

When new versions ship, append to Version History.
When decisions are made, append to Key Decisions Log.
When the registry gains agents, update Capability Registry.
When the system prompt evolves, update the Master Agent System Prompt section.

This document lives in: github.com/jlarivee/lifebridge-v2/LIFEBRIDGE_BUILD_LOG.md
