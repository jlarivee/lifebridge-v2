# LifeBridge Enhance Pipeline — Fix Plan

**Date:** 2026-03-26
**Status:** Ready for Josh's approval
**Context:** Tonight's session exposed 7 failures in the agent builder's enhance pipeline. LifeBridge successfully routed, generated, and deployed an enhancement — but the generated code broke all dashboard styling because the builder overwrote the shared CSS file.

---

## What Went Right

- Master agent routing fix worked (95/100 confidence, correct ENHANCE BRIEF)
- Background dispatch fix worked (no more HTTP timeouts)
- Builder generated files and auto-deployed
- Tests passed (32/32)
- Rollback safety net infrastructure is in place

## What Went Wrong (7 Failures)

### 1. Shared CSS Overwritten → All Dashboards Broken
**Root cause:** Builder told the LLM to output complete files. The LLM regenerated `dashboard.css` (1553 lines) from only 200 lines of context, corrupting it. `writeEnhancementFiles()` does a full overwrite — no merge/append logic.

**Fix:** Three-layer defense:
- **Protected files list** — `dashboard.css`, `config.js`, `dashboard-shell.js` can only be appended to, never overwritten
- **Append-only write mode** — new `===APPEND: path===` format extracts only new CSS rules and appends them
- **File integrity check** — before committing, verify protected files didn't shrink >10% and all critical CSS selectors still exist

### 2. Rollback Didn't Catch Visual Breakage
**Root cause:** Tests check functional behavior (HTTP 200, response structure), not visual output. A completely broken CSS file passes all 32 tests.

**Fix:** Add integrity checks to `deployEnhancementSafe()`:
- Protected files must not shrink more than 10%
- Critical CSS selectors (`.routing`, `.workspace`, `.dash-header`, `.dash-btn`, `.hub`) must survive
- JS config globals (`AGENT_ENDPOINTS`, `DASHBOARD_AGENTS`) must survive
- These checks run BEFORE the test suite, with auto-rollback on failure

### 3. ALLOWED_PREFIXES Too Broad
**Root cause:** `public/js/` and `public/css/` allow writes to core infrastructure files (router, state, API helpers, shared shell). Only dashboard-specific files should be writable.

**Fix:** Tighten to:
```
src/agents/        — agent code
src/skills/        — agent skills
public/js/dashboards/  — dashboard JS only (not core JS)
```
Plus append-only for `public/css/dashboard.css` and `public/js/config.js`.

### 4. Builder Lacks Design System Context
**Root cause:** The LLM gets 200 lines of CSS tail and the agent's JS, but no information about CSS variables, class naming conventions (`dash-*`), available JS helpers, or the dashboard rendering contract.

**Fix:** Create `src/skills/agent-builder-templates/design-system.md` with:
- All CSS custom properties (`--accent-hub`, `--glass-bg`, etc.)
- Class naming convention (`.dash-*` prefix)
- Available JS helpers (`dashChatHtml()`, `postToAgent()`, etc.)
- Dashboard rendering contract (what each dashboard must export)
- Inject this into every enhance prompt

### 5. Session Persistence Broken
**Root cause:** `run()` endpoint always creates a fresh session. When Josh approved with the session ID, the builder started over instead of resuming. The `continueBuild()` function exists and reads from DB, but nothing calls it.

**Fix (already partially solved):** The single-shot approach (all phases in one call) eliminates the need for session resumption. But we need to restore approval gates (see #7). Solution:
- Save session stub to DB immediately (before Claude API call)
- Add `latest-session:{agent}` lookup key
- Add `/agents/builder/status/:agent` endpoint for UI polling

### 6. File Extraction Regex Fragile
**Root cause:** Two competing file output formats in the skill vs the user prompt. LLM may use neither format exactly, producing zero extracted files.

**Fix:** Add 4 extraction patterns:
1. `MODIFIED/NEW FILE:` + fenced code block (original)
2. `===FILE: path===` ... `===END FILE===` (new)
3. `===APPEND: path===` ... `===END APPEND===` (append-only)
4. `### path\n```lang` fallback
Plus debug logging when zero files are extracted.

### 7. Single-Shot Enhance Skips Human Checkpoints
**Root cause:** Tonight's fix made enhance run all phases in one Claude API call to avoid the session persistence bug. This means a single bad LLM response auto-deploys without human review.

**Fix:** Restore 2-phase enhance with proper session persistence:
- **Phase 1:** Plan + generate files → save to DB → show to user for approval
- **Phase 2:** On approval → deploy with rollback safety net
- The UI needs to show the builder's output and provide approve/reject buttons
- The `/agents/builder` endpoint needs to check for existing sessions and resume them

---

## Implementation Order (Priority)

| # | Fix | Impact | Risk | Files |
|---|-----|--------|------|-------|
| 1 | Protected files + append-only mode | Critical — prevents all-dashboard breakage | Low | deploy-tools.js |
| 2 | File integrity checks in deployEnhancementSafe | Critical — catches corruption | Low | deploy-tools.js |
| 3 | Tighten ALLOWED_PREFIXES | High — reduces blast radius | Low | deploy-tools.js |
| 4 | Design system context file | High — improves generated code quality | None | New file + agent-builder-agent.js |
| 5 | Robust file extraction (4 patterns) | High — prevents zero-file deploys | Low | agent-builder-agent.js |
| 6 | Restore 2-phase enhance with session persistence | High — restores human checkpoint | Medium | agent-builder-agent.js, index.js |
| 7 | Builder endpoint non-blocking + status polling | Medium — better UX | Low | index.js |

---

## Test Plan

### Unit Tests (run locally before pushing)

**Test 1: Protected file append-only**
```
Given: dashboard.css has 1553 lines
When: builder outputs a full replacement file of 200 lines
Then: only new CSS rules are appended, file stays >= 1553 lines
```

**Test 2: File integrity check — size shrink**
```
Given: backup of dashboard.css is 1553 lines
When: new file is 200 lines (87% reduction)
Then: integrity check FAILS, rollback triggered
```

**Test 3: File integrity check — missing selectors**
```
Given: backup has .routing, .workspace, .dash-header, .dash-btn
When: new file is missing .dash-header
Then: integrity check FAILS, rollback triggered
```

**Test 4: ALLOWED_PREFIXES blocks core JS**
```
Given: builder tries to write public/js/router.js
When: isPathAllowed() is called
Then: returns false, write is BLOCKED
```

**Test 5: File extraction — all 4 patterns**
```
Given: mock messages with each format variant
When: extractEnhancementFiles() runs
Then: all files extracted correctly from all 4 formats
```

**Test 6: Append extraction — CSS dedup**
```
Given: existing CSS has .dash-card { }
When: builder outputs .dash-card { } and .dash-positions { }
Then: only .dash-positions is appended (no duplicate)
```

### Integration Tests (run on Replit after deploy)

**Test 7: Full enhance pipeline — happy path**
```
POST /route "Add a positions table to the investment dashboard"
→ ENHANCE BRIEF generated
→ Builder runs in background
→ Phase 1 completes, files generated
→ Files pass integrity check
→ CSS appended (not overwritten)
→ All 32+ tests pass
→ Dashboard renders correctly with new positions table
```

**Test 8: Full enhance pipeline — CSS corruption caught**
```
Manually make builder output a truncated CSS file
→ Integrity check catches size reduction
→ Rollback triggered
→ Original files restored
→ All dashboards render correctly
```

**Test 9: All dashboards still render after enhancement**
```
After any enhancement deploy:
→ GET /agents/investment-research-agent dashboard — renders
→ GET /agents/travel-agent dashboard — renders
→ GET /agents/life-sciences-account-agent dashboard — renders
→ All use correct styling (dark theme, glass cards, accent colors)
```

---

## What Josh Approves

1. **The fix order above** — do you agree with priorities?
2. **Restore 2-phase enhance** vs keep single-shot with better guardrails?
3. **Should the builder be allowed to write CSS at all**, or should CSS changes always be manual?
4. **Design system file** — I'll generate it from the actual codebase. Any specific patterns you want documented?

Once approved, I'll implement all fixes, run the test plan locally, and push a single clean commit.
