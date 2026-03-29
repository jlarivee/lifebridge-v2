/**
 * Investment Research Agent Dashboard
 * Real-time portfolio tracking with testing and analysis features
 */

async function renderInvestmentDashboard(el) {
  el.innerHTML = `
    <div class="dash-header">
      <div class="dash-title">Investment Research</div>
      <div class="dash-subtitle">Paper Trading Portfolio & Analysis</div>
    </div>
    
    <div class="dash-tabs">
      <div class="dash-tab active" data-tab="overview">Overview</div>
      <div class="dash-tab" data-tab="positions">Positions</div>
      <div class="dash-tab" data-tab="trades">Recent Trades</div>
      <div class="dash-tab" data-tab="stress-test">Stress Test</div>
      <div class="dash-tab" data-tab="risk-analysis">Risk Analysis</div>
    </div>

    <div id="overview" class="dash-tab-content active">
      <div id="investment-summary" class="dash-loading">Loading portfolio summary...</div>
    </div>

    <div id="positions" class="dash-tab-content">
      <div id="investment-positions" class="dash-loading">Loading positions...</div>
    </div>

    <div id="trades" class="dash-tab-content">
      <div id="investment-trades" class="dash-loading">Loading trades...</div>
    </div>

    <div id="stress-test" class="dash-tab-content">
      <div class="dash-section-label">Portfolio Stress Testing</div>
      <div class="investment-test-controls">
        <button id="run-stress-test" class="dash-btn">Run Stress Test</button>
        <button id="custom-stress-test" class="dash-btn">Custom Scenario</button>
      </div>
      <div id="stress-test-results" class="dash-empty">Click "Run Stress Test" to simulate market scenarios</div>
    </div>

    <div id="risk-analysis" class="dash-tab-content">
      <div class="dash-section-label">Risk Analysis & Metrics</div>
      <div class="investment-test-controls">
        <button id="run-risk-analysis" class="dash-btn">Analyze Portfolio Risk</button>
      </div>
      <div id="risk-analysis-results" class="dash-empty">Click "Analyze Portfolio Risk" to view diversification and risk metrics</div>
    </div>
  `;

  // Setup tab navigation
  setupTabNavigation();

  // Load initial data
  loadInvestmentSummary();
  loadInvestmentPositions();
  loadInvestmentTrades();

  // Setup testing controls
  document.getElementById('run-stress-test').addEventListener('click', runStressTest);
  document.getElementById('run-risk-analysis').addEventListener('click', runRiskAnalysis);

  // Auto-refresh every 60 seconds
  setInterval(() => {
    if (document.getElementById('overview').classList.contains('active')) {
      loadInvestmentSummary();
    }
    if (document.getElementById('positions').classList.contains('active')) {
      loadInvestmentPositions();
    }
  }, 60000);
}

function setupTabNavigation() {
  document.querySelectorAll('.dash-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active from all tabs and content
      document.querySelectorAll('.dash-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.dash-tab-content').forEach(c => c.classList.remove('active'));
      
      // Add active to clicked tab and corresponding content
      tab.classList.add('active');
      const tabId = tab.getAttribute('data-tab');
      document.getElementById(tabId).classList.add('active');
    });
  });
}

async function loadInvestmentSummary() {
  const container = document.getElementById('investment-summary');
  try {
    const resp = await fetch('/investment/summary');
    const data = await resp.json();
    
    if (!data.success) {
      container.innerHTML = '<div class="dash-empty">Error loading portfolio data</div>';
      return;
    }

    const summary = data.output;
    const winRate = summary.win_rate !== null ? `${summary.win_rate}%` : 'N/A';
    const totalPnL = summary.total_pnl || 0;
    const pnlColor = totalPnL >= 0 ? 'positive' : 'negative';

    container.innerHTML = `
      <div class="investment-summary-grid">
        <div class="investment-summary-item">
          <div class="investment-summary-label">Portfolio Value</div>
          <div class="investment-summary-value">$${summary.portfolio_value.toLocaleString()}</div>
        </div>
        <div class="investment-summary-item">
          <div class="investment-summary-label">Available Cash</div>
          <div class="investment-summary-value">$${summary.cash.toLocaleString()}</div>
        </div>
        <div class="investment-summary-item">
          <div class="investment-summary-label">Open Positions</div>
          <div class="investment-summary-value">${summary.positions_count}</div>
        </div>
        <div class="investment-summary-item">
          <div class="investment-summary-label">Watchlist</div>
          <div class="investment-summary-value">${summary.watchlist_count} tickers</div>
        </div>
        <div class="investment-summary-item">
          <div class="investment-summary-label">Win Rate</div>
          <div class="investment-summary-value">${winRate}</div>
        </div>
        <div class="investment-summary-item">
          <div class="investment-summary-label">Total P&L</div>
          <div class="investment-summary-value investment-pnl ${pnlColor}">$${totalPnL.toLocaleString()}</div>
        </div>
      </div>
    `;
  } catch (error) {
    container.innerHTML = '<div class="dash-empty">Error: ' + error.message + '</div>';
  }
}

async function loadInvestmentPositions() {
  const container = document.getElementById('investment-positions');
  try {
    const resp = await fetch('/investment/portfolio');
    const data = await resp.json();
    
    if (!data.success) {
      container.innerHTML = '<div class="dash-empty">Error loading positions</div>';
      return;
    }

    const portfolio = data.output;
    if (portfolio.positions.length === 0) {
      container.innerHTML = `
        <div class="dash-empty">No positions found</div>
        <div style="margin-top: 1rem; padding: 1rem; background: var(--surface-secondary); border-radius: 8px;">
          <strong>Available Cash:</strong> $${portfolio.virtual_cash.toLocaleString()}
        </div>
      `;
      return;
    }

    const positionsHtml = portfolio.positions.map(pos => {
      const currentValue = pos.quantity * (pos.current_price || pos.avg_cost);
      const costBasis = pos.quantity * pos.avg_cost;
      const unrealizedPnL = currentValue - costBasis;
      const returnPct = ((currentValue - costBasis) / costBasis) * 100;
      const pnlColor = unrealizedPnL >= 0 ? 'positive' : 'negative';

      return `
        <tr>
          <td><span class="investment-ticker">${pos.ticker}</span></td>
          <td>${pos.quantity.toLocaleString()}</td>
          <td>$${pos.avg_cost.toFixed(2)}</td>
          <td>$${(pos.current_price || pos.avg_cost).toFixed(2)}</td>
          <td>$${currentValue.toLocaleString()}</td>
          <td class="investment-pnl ${pnlColor}">$${unrealizedPnL.toLocaleString()}</td>
          <td class="investment-pnl ${pnlColor}">${returnPct.toFixed(1)}%</td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <div style="margin-bottom: 1rem; padding: 1rem; background: var(--surface-secondary); border-radius: 8px;">
        <strong>Available Cash:</strong> $${portfolio.virtual_cash.toLocaleString()} | 
        <strong>Total Portfolio Value:</strong> $${portfolio.total_value.toLocaleString()}
      </div>
      <table class="investment-positions-table">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Quantity</th>
            <th>Avg Cost</th>
            <th>Current Price</th>
            <th>Market Value</th>
            <th>Unrealized P&L</th>
            <th>Return %</th>
          </tr>
        </thead>
        <tbody>
          ${positionsHtml}
        </tbody>
      </table>
    `;
  } catch (error) {
    container.innerHTML = '<div class="dash-empty">Error: ' + error.message + '</div>';
  }
}

async function loadInvestmentTrades() {
  const container = document.getElementById('investment-trades');
  try {
    const resp = await fetch('/investment/trades');
    const data = await resp.json();
    
    if (!data.success) {
      container.innerHTML = '<div class="dash-empty">Error loading trades</div>';
      return;
    }

    const trades = data.output.slice(-20).reverse(); // Last 20 trades, most recent first
    if (trades.length === 0) {
      container.innerHTML = '<div class="dash-empty">No trades found</div>';
      return;
    }

    const tradesHtml = trades.map(trade => {
      const date = new Date(trade.executed_at).toLocaleDateString();
      const total = trade.quantity * trade.price;
      
      return `
        <div class="investment-trade-item">
          <div class="investment-trade-header">
            <span class="investment-ticker">${trade.ticker}</span>
            <span class="investment-trade-action ${trade.action}">${trade.action.toUpperCase()}</span>
            <span class="investment-trade-date">${date}</span>
          </div>
          <div class="investment-trade-details">
            ${trade.quantity.toLocaleString()} shares @ $${trade.price.toFixed(2)} = $${total.toLocaleString()}
          </div>
          ${trade.thesis ? `<div class="investment-trade-thesis">"${trade.thesis}"</div>` : ''}
        </div>
      `;
    }).join('');

    container.innerHTML = tradesHtml;
  } catch (error) {
    container.innerHTML = '<div class="dash-empty">Error: ' + error.message + '</div>';
  }
}

async function runStressTest() {
  const container = document.getElementById('stress-test-results');
  const button = document.getElementById('run-stress-test');
  
  button.disabled = true;
  button.textContent = 'Running...';
  container.innerHTML = '<div class="dash-loading">Running stress test scenarios...</div>';

  try {
    const resp = await fetch('/investment/stress-test', { method: 'POST' });
    const data = await resp.json();
    
    if (!data.success) {
      container.innerHTML = `<div class="dash-empty">Error: ${data.output.error || 'Stress test failed'}</div>`;
      return;
    }

    const results = data.output;
    const scenariosHtml = results.stress_test_results.map(scenario => {
      const lossColor = scenario.loss_percent > 20 ? 'negative' : scenario.loss_percent > 10 ? 'warning' : '';
      
      const positionsHtml = scenario.positions.map(pos => `
        <tr>
          <td><span class="investment-ticker">${pos.ticker}</span></td>
          <td>$${pos.current_price}</td>
          <td>$${pos.stressed_price}</td>
          <td class="investment-pnl negative">-$${pos.loss.toLocaleString()}</td>
          <td class="investment-pnl negative">${pos.loss_percent}%</td>
        </tr>
      `).join('');

      return `
        <div class="investment-stress-scenario">
          <div class="investment-scenario-header">
            <h4>${scenario.scenario}</h4>
            <div class="investment-scenario-summary">
              <span>Portfolio: $${scenario.original_value.toLocaleString()} → $${scenario.stressed_value.toLocaleString()}</span>
              <span class="investment-pnl negative" style="margin-left: 1rem;">
                -$${scenario.total_loss.toLocaleString()} (${scenario.loss_percent}%)
              </span>
            </div>
          </div>
          <table class="investment-positions-table" style="margin-top: 0.5rem; font-size: 0.85rem;">
            <thead>
              <tr>
                <th>Ticker</th>
                <th>Current</th>
                <th>Stressed</th>
                <th>Loss $</th>
                <th>Loss %</th>
              </tr>
            </thead>
            <tbody>
              ${positionsHtml}
            </tbody>
          </table>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="investment-test-summary">
        <h3>Stress Test Results</h3>
        <p>Portfolio tested against ${results.stress_test_results.length} scenarios</p>
        <p><strong>Current Portfolio Value:</strong> $${results.portfolio_summary.total_value.toLocaleString()}</p>
      </div>
      ${scenariosHtml}
    `;
  } catch (error) {
    container.innerHTML = '<div class="dash-empty">Error: ' + error.message + '</div>';
  } finally {
    button.disabled = false;
    button.textContent = 'Run Stress Test';
  }
}

async function runRiskAnalysis() {
  const container = document.getElementById('risk-analysis-results');
  const button = document.getElementById('run-risk-analysis');
  
  button.disabled = true;
  button.textContent = 'Analyzing...';
  container.innerHTML = '<div class="dash-loading">Calculating risk metrics...</div>';

  try {
    const resp = await fetch('/investment/risk-analysis', { method: 'POST' });
    const data = await resp.json();
    
    if (!data.success) {
      container.innerHTML = `<div class="dash-empty">Error: ${data.output.error || 'Risk analysis failed'}</div>`;
      return;
    }

    const analysis = data.output;
    const metrics = analysis.risk_metrics;

    // Risk score color
    const riskColor = metrics.risk_score <= 3 ? 'positive' : metrics.risk_score <= 6 ? 'warning' : 'negative';
    
    // Sector allocation chart (simple bars)
    const sectorHtml = Object.entries(metrics.sector_allocation)
      .filter(([sector, pct]) => pct > 0)
      .map(([sector, pct]) => `
        <div class="investment-sector-item">
          <div class="investment-sector-label">${sector}</div>
          <div class="investment-sector-bar">
            <div class="investment-sector-fill" style="width: ${pct}%"></div>
            <span class="investment-sector-percent">${pct}%</span>
          </div>
        </div>
      `).join('');

    const recommendationsHtml = analysis.recommendations.map(rec => `
      <li>${rec}</li>
    `).join('');

    container.innerHTML = `
      <div class="investment-risk-overview">
        <div class="investment-risk-score">
          <div class="investment-risk-score-label">Overall Risk Level</div>
          <div class="investment-risk-score-value investment-pnl ${riskColor}">
            ${metrics.risk_level} (${metrics.risk_score}/10)
          </div>
        </div>
      </div>

      <div class="investment-risk-metrics-grid">
        <div class="investment-risk-metric">
          <div class="investment-metric-label">Largest Position</div>
          <div class="investment-metric-value">${metrics.largest_position.ticker} (${metrics.largest_position.percent}%)</div>
        </div>
        <div class="investment-risk-metric">
          <div class="investment-metric-label">Portfolio Concentration</div>
          <div class="investment-metric-value">${metrics.portfolio_concentration}%</div>
        </div>
        <div class="investment-risk-metric">
          <div class="investment-metric-label">Win Rate</div>
          <div class="investment-metric-value">${metrics.win_rate.toFixed(1)}%</div>
        </div>
        <div class="investment-risk-metric">
          <div class="investment-metric-label">Volatility</div>
          <div class="investment-metric-value">${metrics.volatility.toFixed(1)}%</div>
        </div>
        <div class="investment-risk-metric">
          <div class="investment-metric-label">Max Drawdown</div>
          <div class="investment-metric-value">${metrics.max_drawdown}%</div>
        </div>
        <div class="investment-risk-metric">
          <div class="investment-metric-label">Avg Return</div>
          <div class="investment-metric-value">${metrics.avg_return.toFixed(1)}%</div>
        </div>
      </div>

      <div class="investment-sector-allocation">
        <h4>Sector Allocation</h4>
        ${sectorHtml}
      </div>

      <div class="investment-recommendations">
        <h4>Risk Recommendations</h4>
        <ul>${recommendationsHtml}</ul>
      </div>
    `;
  } catch (error) {
    container.innerHTML = '<div class="dash-empty">Error: ' + error.message + '</div>';
  } finally {
    button.disabled = false;
    button.textContent = 'Analyze Portfolio Risk';
  }
}