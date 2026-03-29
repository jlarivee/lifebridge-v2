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
  endpoints: ["/agents/investment-research-agent", "/investment/watchlist", "/investment/portfolio", "/investment/trades", "/investment/summary", "/investment/stress-test", "/investment/risk-analysis"],
  requires_approval: [],
  dashboard: "/dashboard/investment-research-agent",
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

// ── NEW: Portfolio Testing Features ─────────────────────────────────────────

export async function runInvestmentStressTest(scenarios = []) {
  const portfolio = await getPortfolio();
  
  if (portfolio.positions.length === 0) {
    return {
      agent: "investment-research-agent",
      output: { error: "No positions to stress test" },
      success: false,
    };
  }

  // Default stress test scenarios if none provided
  const defaultScenarios = [
    { name: "Market Crash (-30%)", market_drop: 0.30, correlation: 0.8 },
    { name: "Tech Selloff (-50%)", sector_drop: { tech: 0.50 }, correlation: 0.6 },
    { name: "Interest Rate Spike", rate_sensitive_drop: 0.25, correlation: 0.4 },
    { name: "Black Swan (-60%)", market_drop: 0.60, correlation: 0.9 },
  ];

  const testScenarios = scenarios.length > 0 ? scenarios : defaultScenarios;
  const results = [];

  for (const scenario of testScenarios) {
    const portfolioValue = portfolio.total_value;
    let stressedValue = portfolio.virtual_cash;
    const positionResults = [];

    for (const position of portfolio.positions) {
      const currentValue = position.quantity * (position.current_price || position.avg_cost);
      let stressedPrice = position.current_price || position.avg_cost;

      // Apply stress scenario
      if (scenario.market_drop) {
        const correlation = scenario.correlation || 0.8;
        const actualDrop = scenario.market_drop * correlation + (Math.random() * 0.1 - 0.05);
        stressedPrice *= (1 - Math.max(0, actualDrop));
      }

      if (scenario.sector_drop) {
        // Simple heuristic: tickers with certain patterns are "tech"
        const isTech = /^(AAPL|MSFT|GOOGL|AMZN|TSLA|NVDA|META|NFLX)/.test(position.ticker);
        if (isTech && scenario.sector_drop.tech) {
          stressedPrice *= (1 - scenario.sector_drop.tech);
        }
      }

      if (scenario.rate_sensitive_drop) {
        // REITs, utilities, high-dividend stocks affected more
        const isRateSensitive = /^(REI|VTI|SPY|BND)/.test(position.ticker);
        if (isRateSensitive) {
          stressedPrice *= (1 - scenario.rate_sensitive_drop);
        }
      }

      const stressedValue_position = position.quantity * stressedPrice;
      const loss = currentValue - stressedValue_position;
      const lossPercent = (loss / currentValue) * 100;

      positionResults.push({
        ticker: position.ticker,
        quantity: position.quantity,
        current_price: position.current_price || position.avg_cost,
        stressed_price: Math.round(stressedPrice * 100) / 100,
        current_value: currentValue,
        stressed_value: stressedValue_position,
        loss: Math.round(loss),
        loss_percent: Math.round(lossPercent * 10) / 10,
      });

      stressedValue += stressedValue_position;
    }

    const totalLoss = portfolioValue - stressedValue;
    const totalLossPercent = (totalLoss / portfolioValue) * 100;

    results.push({
      scenario: scenario.name,
      original_value: Math.round(portfolioValue),
      stressed_value: Math.round(stressedValue),
      total_loss: Math.round(totalLoss),
      loss_percent: Math.round(totalLossPercent * 10) / 10,
      positions: positionResults,
    });
  }

  return {
    agent: "investment-research-agent",
    output: {
      portfolio_summary: {
        total_value: portfolio.total_value,
        cash: portfolio.virtual_cash,
        positions_count: portfolio.positions.length,
      },
      stress_test_results: results,
      timestamp: new Date().toISOString(),
    },
    success: true,
  };
}

export async function runInvestmentRiskAnalysis() {
  const [portfolio, trades] = await Promise.all([
    getPortfolio(),
    getTrades(),
  ]);

  if (portfolio.positions.length === 0) {
    return {
      agent: "investment-research-agent",
      output: { error: "No positions to analyze" },
      success: false,
    };
  }

  const closedTrades = trades.filter(t => t.status === "closed" && t.realized_pnl !== null);
  const returns = closedTrades.map(t => t.realized_pnl / (t.quantity * t.price));

  // Calculate basic risk metrics
  const metrics = {
    portfolio_concentration: calculateConcentration(portfolio.positions),
    largest_position: findLargestPosition(portfolio.positions),
    sector_allocation: calculateSectorAllocation(portfolio.positions),
    win_rate: closedTrades.length > 0 ? (closedTrades.filter(t => t.realized_pnl > 0).length / closedTrades.length) * 100 : 0,
    avg_return: returns.length > 0 ? (returns.reduce((a, b) => a + b, 0) / returns.length) * 100 : 0,
    volatility: returns.length > 1 ? calculateVolatility(returns) * 100 : 0,
    max_drawdown: calculateMaxDrawdown(closedTrades),
    risk_score: 0, // calculated below
  };

  // Calculate overall risk score (1-10, 10 = highest risk)
  let riskScore = 0;
  if (metrics.portfolio_concentration > 50) riskScore += 3;
  else if (metrics.portfolio_concentration > 30) riskScore += 2;
  else if (metrics.portfolio_concentration > 20) riskScore += 1;

  if (metrics.largest_position.percent > 40) riskScore += 3;
  else if (metrics.largest_position.percent > 25) riskScore += 2;
  else if (metrics.largest_position.percent > 15) riskScore += 1;

  if (metrics.volatility > 30) riskScore += 2;
  else if (metrics.volatility > 20) riskScore += 1;

  if (metrics.max_drawdown < -30) riskScore += 2;
  else if (metrics.max_drawdown < -20) riskScore += 1;

  metrics.risk_score = Math.min(10, riskScore);

  return {
    agent: "investment-research-agent",
    output: {
      portfolio_value: portfolio.total_value,
      risk_metrics: {
        ...metrics,
        risk_level: metrics.risk_score <= 3 ? "Low" : metrics.risk_score <= 6 ? "Medium" : "High",
      },
      recommendations: generateRiskRecommendations(metrics),
      timestamp: new Date().toISOString(),
    },
    success: true,
  };
}

// Risk calculation helpers
function calculateConcentration(positions) {
  if (positions.length === 0) return 0;
  const totalValue = positions.reduce((sum, p) => sum + (p.quantity * (p.current_price || p.avg_cost)), 0);
  const largest = Math.max(...positions.map(p => p.quantity * (p.current_price || p.avg_cost)));
  return Math.round((largest / totalValue) * 100);
}

function findLargestPosition(positions) {
  if (positions.length === 0) return { ticker: "None", value: 0, percent: 0 };
  const totalValue = positions.reduce((sum, p) => sum + (p.quantity * (p.current_price || p.avg_cost)), 0);
  let largest = positions[0];
  let largestValue = largest.quantity * (largest.current_price || largest.avg_cost);
  
  for (const pos of positions) {
    const value = pos.quantity * (pos.current_price || pos.avg_cost);
    if (value > largestValue) {
      largest = pos;
      largestValue = value;
    }
  }
  
  return {
    ticker: largest.ticker,
    value: Math.round(largestValue),
    percent: Math.round((largestValue / totalValue) * 100),
  };
}

function calculateSectorAllocation(positions) {
  // Simple sector classification
  const sectors = {
    "Technology": ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "NFLX"],
    "Finance": ["JPM", "BAC", "WFC", "GS", "MS"],
    "Healthcare": ["JNJ", "PFE", "UNH", "ABBV", "MRK"],
    "Energy": ["XOM", "CVX", "COP", "EOG"],
    "ETF": ["SPY", "QQQ", "VTI", "IWM", "EFA"]
  };

  const allocation = {};
  const totalValue = positions.reduce((sum, p) => sum + (p.quantity * (p.current_price || p.avg_cost)), 0);

  for (const [sector, tickers] of Object.entries(sectors)) {
    const sectorValue = positions
      .filter(p => tickers.includes(p.ticker))
      .reduce((sum, p) => sum + (p.quantity * (p.current_price || p.avg_cost)), 0);
    allocation[sector] = Math.round((sectorValue / totalValue) * 100);
  }

  // Everything else is "Other"
  const knownValue = Object.values(allocation).reduce((a, b) => a + b, 0);
  allocation["Other"] = Math.max(0, 100 - knownValue);

  return allocation;
}

function calculateVolatility(returns) {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  return Math.sqrt(variance);
}

function calculateMaxDrawdown(trades) {
  if (trades.length === 0) return 0;
  let peak = 0;
  let runningPnL = 0;
  let maxDrawdown = 0;

  for (const trade of trades) {
    runningPnL += trade.realized_pnl || 0;
    if (runningPnL > peak) {
      peak = runningPnL;
    }
    const drawdown = ((peak - runningPnL) / Math.max(Math.abs(peak), 1)) * 100;
    maxDrawdown = Math.min(maxDrawdown, -drawdown);
  }

  return Math.round(maxDrawdown);
}

function generateRiskRecommendations(metrics) {
  const recommendations = [];

  if (metrics.portfolio_concentration > 30) {
    recommendations.push("Consider diversifying - your portfolio is concentrated in a single position");
  }
  
  if (metrics.largest_position.percent > 25) {
    recommendations.push(`Your largest position (${metrics.largest_position.ticker}) represents ${metrics.largest_position.percent}% of your portfolio`);
  }

  if (Object.values(metrics.sector_allocation).some(pct => pct > 60)) {
    recommendations.push("Consider adding exposure to different sectors for better diversification");
  }

  if (metrics.volatility > 25) {
    recommendations.push("High volatility detected - consider adding some stable, dividend-paying stocks");
  }

  if (metrics.win_rate < 50 && metrics.win_rate > 0) {
    recommendations.push("Win rate below 50% - review your entry and exit criteria");
  }

  if (recommendations.length === 0) {
    recommendations.push("Your portfolio risk profile looks well-balanced");
  }

  return recommendations;
}