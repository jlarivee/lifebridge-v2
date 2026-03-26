# LifeBridge Master Build Log

**Project:** LifeBridge Autonomous Agent Operating System  
**Owner:** Josh Larivee  
**Started:** March 22, 2026  
**Current version:** v2.6 (shipped — frontend refactored)
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

### v2.1 — Memory Consolidation Agent + Test Suite Hardening
**What was built:**
Memory Consolidation Agent (src/agents/memory-consolidation-agent.js)
- Weekly Sunday 3:00 AM UTC — reads all request logs, extracts durable facts
- Claude-powered analysis across 5 categories: preferences, constraints,
  learned_patterns, people, accounts
- Confidence threshold: 70+ to propose, never writes context directly
- Full proposal CRUD with human approval gate
- Staleness detection for outdated context facts

Routes added:
- POST /memory/run
- GET  /memory/proposals
- GET  /memory/proposals/:id
- POST /memory/proposals/:id/approve  (writes to context on approval)
- POST /memory/proposals/:id/reject
- GET  /memory/facts
- GET  /memory/history
- POST /agents/memory-consolidation-agent

Skill file: src/skills/memory-consolidation-agent.md (118 lines)

Test Suite Hardening:
- Fixed fast tier hanging (was 30s+ timeout, now ~11s)
- Root cause: checkTrends() and checkDeadAgents() doing full DB scans
  on every agent in fast tier
- Fix: skip all DB scans and writes in fast tier
- Added tier guard in runTestCase: fast tier never calls callAgentViaRoute
- Added DB backfill: patches stored test cases missing type: "endpoint"
- Fixed /agents/:name/detail timeout: replaced unbounded DB scan with
  per-agent cache (agent-recent-runs:{name})

Test results: 26/26 passing, 0 failures, ~11 seconds

**Git commits:** c32dcfb, 5450c1a, d761fcd, ba61da2

---

### v2.2 — Italy 2026 Connector
**What was built:**
- Read-only /api/lifebridge endpoint added to Italy 2026 app (github.com/jlarivee/italy2026)
  - Authenticated via x-lifebridge-key header (32-char hex)
  - Returns: trip summary, bookings, calendar, packing, ideas, filtered views
  - Health check at /api/lifebridge/health (no auth required)
- italy2026-connector.js with 1-hour cache (src/connectors/italy2026-connector.js)
  - Graceful degradation: serves stale cache if live fetch fails
  - Health check with latency measurement
- Travel Agent auto-injects Italy trip data into every request
  - Flights, hotels, calendar, restaurants, activities, packing progress
  - Skill file updated with Italy 2026 data section
- Italy 2026 hub node under Personal Life domain (#2A6496 travel blue)
  - Registered as external_app in registry
  - Click opens Italy 2026 dashboard
- /dashboard/italy2026 with 4 tabs:
  - Itinerary: calendar events grouped by day
  - Bookings: flights, hotels, restaurants, activities in sections
  - Packing: progress bar + unchecked items grouped by category
  - Ideas: voted list with vote counts
- LifeBridge routes: GET /connectors/italy2026/health, GET /connectors/italy2026/data

**External app pattern established:** First cross-app connector in LifeBridge.
Apps expose read-only APIs, LifeBridge consumes via connectors with caching.

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

### v2.4 — Agent Lifecycle Management
**What was built:**
- GET /agents/{name}/detail — full agent detail including skill file, code file, test suite, run history, version history
- PUT /agents/{name}/skill — edit skill file from UI with automatic version saving
- POST /agents/{name}/pause — pause agent without deleting
- POST /agents/{name}/resume — resume paused agent
- DELETE /agents/{name} — clean delete, removes registry entry, health endpoint, test suite, commits removal to GitHub
- GET /agents/{name}/versions — full version history per agent
- Version tracking on all skill file edits — 5 versions captured on life-sciences-account-agent during testing

**Test results:** 14 passed, 0 failed
**Agents with lifecycle management:** all 6 active agents

---

### v2.5 — Connectors Live (Gmail + Slack)
**What was built:**
- src/agents/connectors.js + src/skills/connectors.md
- Gmail connector — SMTP mode via jlarivee@gmail.com, app password auth, sends real email (confirmed via message_id)
- Slack connector — Replit native API, LifeBridge workspace, webhook fallback
- 9 endpoints: status, test, gmail/send, gmail/read, slack/send, approve, log, config GET/PUT
- sendSystemAlert() helper wired into registry-integrity-agent, test-agent, intelligence-update-agent
- Dual-mode design: OAuth first, SMTP fallback for Gmail; native API first, webhook fallback for Slack
- Approval gate: pending sends stored in DB, require explicit POST /connectors/approve/:id before delivery

**Test results:** 20 passed, 0 failed
**Connectors status:** Gmail connected: true, Slack connected: true

### v2.6 — Frontend Architecture Refactor
**Date:** March 24-25, 2026
**Commit:** Phase 6.7 final

5,349-line monolithic index.html refactored into 28 files across 6 phases. 94% reduction. Zero regressions throughout.

Structure:
```
public/
  index.html (317 lines — pure HTML shell)
  css/ — variables, reset, components, hub, dashboard, mobile
  js/
    config.js      — all agent routing maps
    api.js         — all 47 API calls centralized
    state.js       — global mutable state
    router.js      — all navigation logic
    utils.js       — shared utilities
    hub/           — hub-svg.js, hub-interactions.js, hub.js
    dashboards/    — shell + 6 agent dashboards
    views/         — workspace, improvement, landscape,
                     ideas, tests, health, intel
```

Rules enforced:
- Zero fetch() calls outside api.js
- Zero navigation outside router.js
- Zero CSS custom properties outside variables.css
- One responsibility per file

Safety rollback: `git checkout v2.4-pre-refactor`
**Test results:** 26 passed, 0 failed

---

## The Master Agent System Prompt (Current — v2.5)

Stored as src/skills/master-agent.md. Includes reasoning protocol with confidence scoring, Claude-native capabilities reference, connectors registry section, and explicit routing instruction for the life-sciences-account-agent. Full content lives in the skill file — not duplicated here to avoid drift.

---

## Capability Registry (Current State)

| Agent | Domain | Status |
|---|---|---|
| life-sciences-account-agent | Work | Active |
| morning-briefing-agent | System | Active |
| intelligence-update-agent | System | Active |
| registry-integrity-agent | System | Active |
| test-agent | System | Active |
| memory-consolidation-agent | System | Active |
| travel-agent | Personal Life | Active |
| slab-inventory-tracker-agent | Personal Business | Active |
| agent-builder-agent | System | Active |

**Claude-native capabilities:** web_search, code_execution, file_reading, api_calls, artifact_creation, structured_reasoning, skill_invocation

**Connectors:**
| Connector | Type | Status |
|---|---|---|
| Gmail | SMTP (jlarivee@gmail.com) | Connected |
| Slack | Replit native API + webhook | Connected |
| Italy 2026 | REST API (x-lifebridge-key auth) | Connected |

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
| 7:00 AM Mon-Sat | Test Agent (fast tier) | Daily |
| 7:00 AM Sunday | Test Agent (full tier) | Weekly |
| 7:30 AM | Morning Briefing Agent | Daily |
| 8:00 AM | Travel Agent — flight watch check | Daily |
| 3:00 AM Sunday | Memory Consolidation Agent | Weekly |
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
### Completed — agent lifecycle management (14/14 tests passing) ✅

### Completed — connectors live (Gmail + Slack, 20/20 tests) ✅

### Completed — Morning Briefing Agent (v2.5) ✅

### Next priority (in order)

1. **Investment Research Agent (paper trading)**
   - NOT real financial advice — paper money only
   - $1K hypothetical per thesis, 90-day tracking
   - 3 theses per week
   - Learns from its own predictions over time
   - Stores all historical data to build bigger trends
   - IMPORTANT: Always clearly labeled as paper trading, never real investment advice

2. **Morning Briefing fix** — dashboard URL hardcoded to localhost:5000, should use process.env.REPLIT_URL

3. **Slab cut dates fix** — both walnut slabs incorrectly entered as 2024-03-01, should be 2026-03-01

### Future capabilities
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
| Agent lifecycle | Full CRUD on agents from UI | Agents can be edited, paused, resumed, deleted without touching code directly |
| Gmail connector | SMTP with app password | Replit OAuth integration explored, SMTP more reliable |
| Slack connector | Replit native API | Personal LifeBridge workspace, separate from AWS Slack |
| Hub UI | Card grid default, SVG viz in Landscape | Aerospace HUD looks great but card grid is more practical for daily use |
| Italy 2026 connector | REST API with auth key + 1-hour cache | First cross-app connector — established the external app pattern |
| Config fallback chain | env → DB → hardcoded | Replit workspace secrets don't inject into process.env reliably |
| Claude Code workflow | Build locally → git push → Replit pulls | Claude Code on iMac for building/reviewing, Replit for running live |
| Domain masters | 5 domains: AWS LS, Three Rivers, MadSprings, Personal Life, System | Hub redesign groups agents under domain masters — cleaner mental model |
| Travel Agent size | 664 lines, largest spoke agent | Trip/flight/loyalty/docs CRUD justifies the size — it's a full travel OS |

---

## Token Economy Rules

Josh is on the Claude Max plan. Token burn must be managed carefully. These rules are non-negotiable for every agent and every build.

### The Core Rule
Never call the Anthropic API when a database read will do. Every unnecessary Claude API call costs tokens. Every test that invokes Claude costs tokens. Design agents to be data-first, Claude-last.

### Test Tier Rules
Every test case must be marked fast or full.

fast — hits an endpoint, reads from DB, checks a status. Never calls Claude API. Runs in milliseconds. These run on every sync, every deploy, every morning.

full — invokes Claude to generate a response. Costs tokens. Runs Sunday 7AM UTC only, or manually. Never runs automatically during daily operations.

Fast tests are the default. Full tests require explicit intent. When in doubt, make it fast.

### Agent Design Rules
- Health check endpoints must NEVER call Claude API
- GET endpoints must read from Replit Database only
- Claude API calls happen only in POST action endpoints
- Every agent must have a lightweight status check that costs zero tokens
- Briefing previews and intelligence scans are full-tier only
- Never run POST /briefing/run or POST /intelligence/run in automated test suites

### Build Rules
- Test cases are written before code (test-first)
- New test cases default to fast tier unless Claude is required
- Claude Code prompts must specify tier for every new test case
- Never add a full-tier test without a comment explaining why Claude invocation is necessary for that specific case

### Monitoring Rules
- If daily token usage seems high, run GET /test/verify first to check how many full-tier tests ran unexpectedly
- The morning briefing compiles data but should NOT run POST /intelligence/run or POST /test/run inside itself. Those are separate scheduled jobs, not briefing dependencies.
- Intelligence scans run once daily at 6AM — never on demand inside other agents

### What Costs Tokens (avoid unnecessarily)
- POST /briefing/run — compiles + delivers full briefing
- POST /briefing/preview — compiles without sending
- POST /intelligence/run — scans 6 external sources
- POST /test/run?tier=full — runs all Claude-invoking tests
- POST /agents/{name} with natural language request
- POST /memory/run — analyzes all logs with Claude

### What Costs Zero Tokens (use freely)
- GET /agents/{name}/health
- GET /registry
- GET /test/suites
- GET /integrity/reports/latest
- GET /intelligence/findings
- GET /briefing/latest
- GET /travel/profile
- GET /memory/facts
- POST /test/run (fast tier, default)
- POST /integrity/run

### Emergency Brake
If you suspect runaway token usage:
1. Go to Replit Shell
2. Run: curl -s http://localhost:5000/connectors/status (zero tokens — just a DB read)
3. Check Anthropic console for usage spike
4. If a cron job is misfiring: kill 1 to restart server
5. Review node-cron schedule in src/index.js for runaway jobs

---

## Session Notes — March 24, 2026 (Session 1 — Morning)

- Token economy rules added to build log (v2.5)
- Fast/full tier split implemented in test suite — 35 fast, 13 full
- Connector sends (gmail, slack) and POST /integrity/run moved from fast to full tier
- Intelligence-update-agent "list pending proposals" POST moved from fast to full tier
- Session ended at 90% context limit

## Session Notes — March 24, 2026 (Session 2 — "Connect to lifebridge-v2 GitHub repository")

This was a major build session. Everything below was built, committed, and pushed.

### Memory Consolidation Agent — BUILT ✅
- src/agents/memory-consolidation-agent.js (325 lines)
- src/skills/memory-consolidation-agent.md (118 lines)
- 8 routes: /memory/run, /memory/proposals, /memory/proposals/:id, approve, reject, /memory/facts, /memory/history
- POST /agents/memory-consolidation-agent
- Weekly Sunday 3:00 AM UTC cron job
- 5 categories: preferences, constraints, learned_patterns, people, accounts
- Confidence threshold: 70+ to propose, never writes context directly
- All proposals require human approval gate
- Staleness detection for outdated context facts
- 7 test cases (5 fast, 2 full)
- Git commits: ba61da2, f1d713b, a3c774d

### Fast Tier Test Suite — FIXED ✅
- Root cause: checkTrends() and checkDeadAgents() doing full DB scans on every agent in fast tier
- Fix: skip all DB scans and writes in fast tier
- Added tier guard in runTestCase: fast tier never calls callAgentViaRoute
- Added DB backfill: patches stored test cases missing type: "endpoint"
- Fixed /agents/:name/detail timeout: replaced unbounded DB scan with per-agent cache
- Test results: 26/26 passing, ~11 seconds
- Git commits: c32dcfb, 5450c1a, d761fcd, aed0988

### Full-Page Agent Dashboards — BUILT ✅
- 5 agent dashboards with two-zone layout (data panel + chat)
- Morning Briefing: last 7 briefings, expand to read, Run/Preview buttons
- Life Sciences Account: recent requests + 6 account cards (Pfizer, BMS, Novartis, Lilly, Cigna, Elevance)
- Travel: upcoming trips, flight watches, profile summary, Plan a Trip
- Three Rivers Slab: full inventory display, Add Slab / View All
- Memory Consolidation: tabbed (Proposals/Facts/History), per-proposal Approve/Reject
- Each dashboard includes chat input POSTing to the agent endpoint
- Git commit: 155ae0b

### Hub Redesign — Nested Domain Master Architecture ✅
- Replaced flat spoke grid with two-ring radial SVG visualization
- Center: Master Agent node with pulsing glow
- Middle ring: 5 domain masters (AWS Life Sciences, Three Rivers Slab, MadSprings, Personal Life, System)
- Outer ring: sub-agent nodes per domain, expand/collapse on click
- Coming-soon nodes with dashed stroke and tooltip
- Aerospace HUD aesthetic (JetBrains Mono, SVG filter glow, #00FF88 accent)
- Mobile fallback: vertical accordion list
- Card grid restored as default hub view; SVG viz in Landscape only
- Git commits: 6e0263a, ca41606, 7841592, 53dd5d9, e4b9927

### Italy 2026 Connector — BUILT ✅
- **Italy 2026 app side:** GET /api/lifebridge (authenticated, x-lifebridge-key header, 32-char hex)
  - Returns: trip summary, bookings, calendar, packing, ideas, filtered views
  - GET /api/lifebridge/health (no auth required)
- **LifeBridge side:** src/connectors/italy2026-connector.js (95 lines)
  - 1-hour cache in Replit DB, graceful degradation with stale cache fallback
  - Health check with latency measurement
  - Config fallback chain: env vars → Replit DB → hardcoded defaults
- Travel Agent auto-injects Italy data into Claude prompt context
- Italy 2026 hub node under Personal Life domain (#2A6496 travel blue)
- /dashboard/italy2026 with 4 tabs: Itinerary, Bookings, Packing, Ideas
- Routes: GET /connectors/italy2026/health, GET /connectors/italy2026/data
- External app pattern established: first cross-app connector in LifeBridge
- Git commits: db7b0cc, 41c2e03, fc775e6, e8c1324, eccfd40, 84f6e07

### Travel Agent — BUILT ✅
- src/agents/travel-agent.js (664 lines) — the largest spoke agent
- src/skills/travel-agent.md
- Full CRUD endpoints for trips, flight watches, loyalty snapshots, travel docs
- Profile: Delta Diamond, Hilton Diamond, Marriott Platinum, National Executive, BDL/JFK/LGA
- Daily 8AM UTC flight watch check + daily doc expiry check
- Quarterly loyalty snapshot reminder
- Italy 2026 data auto-injected from connector
- Registered in registry on startup

### Cleanup
- Removed orphaned test-deletion-agent skill file (registry integrity warning)
- Git commit: 3c12e36

### Codebase Stats After Session 2
- public/index.html: 5,206 lines
- src/index.js: 1,671 lines (all routes, startup, cron)
- Total agent code: ~3,214 lines across 12 agent files
- Total project: ~10,186 lines (agents + connectors + tools + server)

### Claude Code MCP Server Connected
- This session established Claude Code on the local Mac connecting directly to the lifebridge-v2 GitHub repo
- Local clone at ~/Drews Trip/lifebridge-v2, syncs with Replit via git pull/push
- Claude Code settings allow: npm, gh, curl to Replit, node --check, Claude Preview
- launch.json configured for Italy 2026 local dev (api-server port 3001, vite-client port 5173)
- This is the new workflow: Claude Code for building/reviewing → git push → Replit pulls and runs

---

## How to Use This Document

At the start of any new session in this Claude Project, reference this document.
It contains everything needed to resume work without re-reading the full conversation.

When new versions ship, append to Version History.
When decisions are made, append to Key Decisions Log.
When the registry gains agents, update Capability Registry.
When the system prompt evolves, update the Master Agent System Prompt section.

This document lives in: github.com/jlarivee/lifebridge-v2/LIFEBRIDGE_BUILD_LOG.md
