# LifeBridge v2.0

## Overview
LifeBridge is a hub-spoke agent orchestration system built on Claude Agent SDK. It features a master routing agent that analyzes user requests and routes them to specialized spoke agents, with a self-improvement feedback loop.

## Architecture
- **Backend**: Node.js + Express, vanilla JS (no framework)
- **Frontend**: Single-page app in `public/index.html` using vanilla JS/HTML/CSS
- **Database**: Replit DB for persistence
- **Fonts**: JetBrains Mono + Inter

## Frontend: Hub-Spoke UI
The frontend uses a four-state hub-spoke navigation model:
1. **Hub** (home): Master agent input bar, spoke agent cards from `GET /registry`, links to Landscape and Improvement
2. **Routing** (transitional): Shows master agent reasoning, confidence ring, auto-transitions to agent workspace if confidence >= 90, shows confirmation prompt otherwise
3. **Agent Workspace**: Per-agent workspace with teal accent color, quick-action chips, structured output rendering, feedback flow
4. **Landscape** (topology): Interactive canvas-based visualization showing the hub-spoke architecture with animated particle connections, hover tooltips showing agent details/patterns, click-to-navigate to agent workspaces

Visual polish: gradient title, radial glow background on hub, animated particles on landscape connections, pulsing hub node, orbit particles.
Smooth CSS transitions between states, dark theme throughout. No page reloads.

## API Endpoints
- `POST /route` — Route user request through master agent
- `POST /route/feedback` — Submit feedback (accepted/rejected)
- `POST /agents/account` — Life Sciences Account Agent
- `GET /registry` — Get registered spoke agents
- `GET /context` — Get global context
- `POST /improve/run` — Run improvement cycle
- `GET /improve/history` — Get improvement history
- `POST /improve/approve` — Approve a proposed change
- `POST /improve/reject` — Reject a proposed change

## Key Files
- `public/index.html` — Full frontend (HTML + CSS + JS)
- `src/index.js` — Express server and route definitions
- `src/agents/master-agent.js` — Master routing agent
- `src/agents/life-sciences-account-agent.js` — Life Sciences spoke agent
- `src/agents/improvement-agent.js` — Self-improvement agent
- `src/db.js` — Database layer
- `src/tools/` — Tool modules (log, approval, registry, context)

## Design System
- Background: `#050507` (primary), `#0c0c10` (secondary), `#111116` (cards)
- Hub accent: `#8b7cf7` (purple)
- Agent workspace accent: `#2dd4bf` (teal)
- Improvement accent: `#f59e0b` (amber)
- Success: `#22c55e`, Error: `#ef4444`
