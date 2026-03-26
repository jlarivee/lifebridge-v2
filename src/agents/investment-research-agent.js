/**
 * LifeBridge Investment Research Agent
 * Paper trading, watchlists, stock research, and virtual portfolio management.
 * No real money. No brokerage connections. Research and education only.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { v4 as uuidv4 } from "uuid";
import * as db from "../db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(
  join(__dirname, "../skills/investment-research-agent.md"),
  "utf8"
);

const client = new Anthropic();

// ── Auto-Registration Metadata ──────────────────────────────────────────────

export const AGENT_META = {
  name: "investment-research-agent",
  domain: "Personal Life",
  purpose: "Paper trading, watchlists, stock/ETF research, and virtual portfolio management — no real money",
  status: "Active",
  skill_file: "src/skills/investment-research-agent.md",
  code_file: "src/agents/investment-research-agent.js",
  trigger_patterns: ["invest", "stock", "trade", "portfolio", "watchlist", "market", "ticker", "buy shares", "sell shares", "research AAPL", "paper trade", "P&L", "holdings"],
  triggers: ["manual"],
  endpoints: ["/agents/investment-research-agent", "/investment/watchlist", "/investment/portfolio", "/investment/trades", "/investment/summary"],
  requires_approval: [],
};

const DB_KEYS = {
  watchlist: "investment-watchlist",
  portfolio: "investment-portfolio",
  trades: "investment-trades",
};

// ── Data Access ─────────────────────────────────────────────────────────────

async function getWatchlist() {
  return (await db.get(DB_KEYS.watchlist)) || [];
}

async function saveWatchlist(list) {
  await db.set(DB_KEYS.watchlist, list);
}

async function getPortfolio() {
  return (await db.get(DB_KEYS.portfolio)) || {
    virtual_cash: 100000,
    positions: [],
    total_value: 100000,
    inception_date: new Date().toISOString(),
  };
}

async function savePortfolio(portfolio) {
  await db.set(DB_KEYS.portfolio, portfolio);
}

async function getTrades() {
  return (await db.get(DB_KEYS.trades)) || [];
}

async function saveTrades(trades) {
  await db.set(DB_KEYS.trades, trades);
}

// ── Agent Runner ────────────────────────────────────────────────────────────

export async function runInvestmentResearchAgent(request, context = {}) {
  const [watchlist, portfolio, trades] = await Promise.all([
    getWatchlist(),
    getPortfolio(),
    getTrades(),
  ]);

  const openTrades = trades.filter((t) => t.status === "open");
  const recentTrades = trades.slice(-10);

  const systemPrompt = `${skill}

Current watchlist (${watchlist.length} tickers):
${JSON.stringify(watchlist, null, 2)}

Paper portfolio:
- Cash: $${portfolio.virtual_cash.toLocaleString()}
- Positions: ${portfolio.positions.length}
- Total value: $${portfolio.total_value.toLocaleString()}
${JSON.stringify(portfolio.positions, null, 2)}

Open trades: ${openTrades.length}
Recent trades (last 10):
${JSON.stringify(recentTrades, null, 2)}

Context from master agent:
${JSON.stringify(context, null, 2)}

IMPORTANT: When modifying watchlist, portfolio, or trades, output the updated
data as JSON in a code block labeled \`\`\`json so the caller can parse and save it.
Use this format:
{ "save": "watchlist|portfolio|trade", "data": <the data to save> }

For new trades, use:
{ "save": "trade", "data": { "id": "<uuid>", "ticker": "...", "action": "buy|sell", ... } }`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    tools: [
      {
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 5,
      },
    ],
    messages: [{ role: "user", content: request }],
  });

  const output = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  // Parse and save any structured data from the response
  try {
    const jsonBlocks = output.matchAll(/```json\n([\s\S]*?)\n```/g);
    for (const match of jsonBlocks) {
      const parsed = JSON.parse(match[1]);
      if (parsed.save === "watchlist" && Array.isArray(parsed.data)) {
        await saveWatchlist(parsed.data);
      } else if (parsed.save === "portfolio" && parsed.data) {
        await savePortfolio(parsed.data);
      } else if (parsed.save === "trade" && parsed.data) {
        const allTrades = await getTrades();
        const existing = allTrades.findIndex((t) => t.id === parsed.data.id);
        if (existing >= 0) {
          allTrades[existing] = parsed.data;
        } else {
          parsed.data.id = parsed.data.id || uuidv4();
          allTrades.push(parsed.data);
        }
        await saveTrades(allTrades);

        // Update portfolio positions on buy/sell
        if (parsed.data.action === "buy" || parsed.data.action === "sell") {
          await updatePortfolioFromTrade(parsed.data);
        }
      }
    }
  } catch {}

  return {
    agent: "investment-research-agent",
    request,
    output: output || "No output produced",
    success: true,
    action_taken: detectAction(request),
    requires_approval: false,
    approval_reason: null,
  };
}

function detectAction(request) {
  const lower = request.toLowerCase();
  if (lower.includes("buy") || lower.includes("sell") || lower.includes("trade"))
    return "paper_trade";
  if (lower.includes("watchlist") || lower.includes("watch") || lower.includes("add") || lower.includes("remove"))
    return "watchlist";
  if (lower.includes("portfolio") || lower.includes("p&l") || lower.includes("holdings"))
    return "portfolio";
  if (lower.includes("scan") || lower.includes("morning"))
    return "morning_scan";
  return "research";
}

async function updatePortfolioFromTrade(trade) {
  const portfolio = await getPortfolio();

  if (trade.action === "buy") {
    const cost = trade.quantity * trade.price;
    portfolio.virtual_cash -= cost;

    const existing = portfolio.positions.find((p) => p.ticker === trade.ticker);
    if (existing) {
      const totalQty = existing.quantity + trade.quantity;
      existing.avg_cost =
        (existing.avg_cost * existing.quantity + trade.price * trade.quantity) /
        totalQty;
      existing.quantity = totalQty;
    } else {
      portfolio.positions.push({
        ticker: trade.ticker,
        quantity: trade.quantity,
        avg_cost: trade.price,
        current_price: trade.price,
        unrealized_pnl: 0,
      });
    }
  } else if (trade.action === "sell") {
    const proceeds = trade.quantity * trade.price;
    portfolio.virtual_cash += proceeds;

    const existing = portfolio.positions.find((p) => p.ticker === trade.ticker);
    if (existing) {
      existing.quantity -= trade.quantity;
      if (existing.quantity <= 0) {
        portfolio.positions = portfolio.positions.filter(
          (p) => p.ticker !== trade.ticker
        );
      }
    }
  }

  // Recalculate total value
  const positionsValue = portfolio.positions.reduce(
    (sum, p) => sum + p.quantity * (p.current_price || p.avg_cost),
    0
  );
  portfolio.total_value = portfolio.virtual_cash + positionsValue;

  await savePortfolio(portfolio);
}

// ── Read-Only Endpoints (no Claude API) ─────────────────────────────────────

export async function getInvestmentWatchlist() {
  return {
    agent: "investment-research-agent",
    output: await getWatchlist(),
    success: true,
  };
}

export async function getInvestmentPortfolio() {
  const portfolio = await getPortfolio();
  return {
    agent: "investment-research-agent",
    output: portfolio,
    success: true,
  };
}

export async function getInvestmentTrades(status) {
  let trades = await getTrades();
  if (status) trades = trades.filter((t) => t.status === status);
  return {
    agent: "investment-research-agent",
    output: trades,
    success: true,
  };
}

export async function getInvestmentSummary() {
  const [watchlist, portfolio, trades] = await Promise.all([
    getWatchlist(),
    getPortfolio(),
    getTrades(),
  ]);

  const openTrades = trades.filter((t) => t.status === "open");
  const closedTrades = trades.filter((t) => t.status === "closed");
  const wins = closedTrades.filter((t) => (t.realized_pnl || 0) > 0);

  return {
    agent: "investment-research-agent",
    output: {
      watchlist_count: watchlist.length,
      tickers: watchlist.map((w) => w.ticker),
      portfolio_value: portfolio.total_value,
      cash: portfolio.virtual_cash,
      positions_count: portfolio.positions.length,
      open_trades: openTrades.length,
      closed_trades: closedTrades.length,
      win_rate:
        closedTrades.length > 0
          ? Math.round((wins.length / closedTrades.length) * 100)
          : null,
      total_pnl: closedTrades.reduce((s, t) => s + (t.realized_pnl || 0), 0),
    },
    success: true,
  };
}
