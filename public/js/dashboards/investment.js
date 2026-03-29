/**
 * Investment Research Agent Dashboard
 * Displays persistent positions table with auto-refresh
 */

async function renderInvestmentDashboard(el) {
  el.innerHTML = `
    <div class="dash-header">
      <div class="dash-title">Investment Portfolio</div>
      <div class="dash-subtitle">Paper trading positions and P&L</div>
    </div>
    
    <div class="dash-card">
      <div class="dash-card-body">
        <div class="dash-section-label">Portfolio Summary</div>
        <div id="portfolio-summary" class="investment-summary">
          <div class="dash-loading">Loading portfolio summary...</div>
        </div>
      </div>
    </div>

    <div class="dash-card">
      <div class="dash-card-body">
        <div class="dash-section-label">Current Positions</div>
        <div id="positions-table" class="investment-positions">
          <div class="dash-loading">Loading positions...</div>
        </div>
      </div>
    </div>

    <div class="dash-card">
      <div class="dash-card-body">
        <div class="dash-section-label">Recent Activity</div>
        <div id="recent-trades" class="investment-trades">
          <div class="dash-loading">Loading recent trades...</div>
        </div>
      </div>
    </div>
  `;

  // Load initial data
  loadPortfolioData();
  
  // Set up auto-refresh every 60 seconds
  setInterval(loadPortfolioData, 60000);
}

async function loadPortfolioData() {
  try {
    const [portfolioResp, tradesResp] = await Promise.all([
      fetch('/investment/portfolio'),
      fetch('/investment/trades')
    ]);
    
    const portfolioData = await portfolioResp.json();
    const tradesData = await tradesResp.json();
    
    if (portfolioData.success) {
      renderPortfolioSummary(portfolioData.output);
      renderPositionsTable(portfolioData.output.positions || []);
    } else {
      document.getElementById('portfolio-summary').innerHTML = 
        '<div class="dash-empty">Error loading portfolio data</div>';
    }
    
    if (tradesData.success) {
      renderRecentTrades(tradesData.output.slice(-5)); // Last 5 trades
    } else {
      document.getElementById('recent-trades').innerHTML = 
        '<div class="dash-empty">Error loading trades data</div>';
    }
    
  } catch (error) {
    console.error('Error loading portfolio data:', error);
    document.getElementById('portfolio-summary').innerHTML = 
      '<div class="dash-empty">Connection error</div>';
    document.getElementById('positions-table').innerHTML = 
      '<div class="dash-empty">Connection error</div>';
    document.getElementById('recent-trades').innerHTML = 
      '<div class="dash-empty">Connection error</div>';
  }
}

function renderPortfolioSummary(portfolio) {
  const totalValue = portfolio.total_value || 0;
  const cash = portfolio.virtual_cash || 0;
  const positionsValue = totalValue - cash;
  const positionsCount = portfolio.positions ? portfolio.positions.length : 0;
  
  document.getElementById('portfolio-summary').innerHTML = `
    <div class="investment-summary-grid">
      <div class="investment-summary-item">
        <div class="investment-summary-label">Total Value</div>
        <div class="investment-summary-value">$${totalValue.toLocaleString()}</div>
      </div>
      <div class="investment-summary-item">
        <div class="investment-summary-label">Cash</div>
        <div class="investment-summary-value">$${cash.toLocaleString()}</div>
      </div>
      <div class="investment-summary-item">
        <div class="investment-summary-label">Positions Value</div>
        <div class="investment-summary-value">$${positionsValue.toLocaleString()}</div>
      </div>
      <div class="investment-summary-item">
        <div class="investment-summary-label">Positions</div>
        <div class="investment-summary-value">${positionsCount}</div>
      </div>
    </div>
  `;
}

function renderPositionsTable(positions) {
  const container = document.getElementById('positions-table');
  
  if (!positions || positions.length === 0) {
    container.innerHTML = '<div class="dash-empty">No positions to display</div>';
    return;
  }
  
  const tableHtml = `
    <table class="investment-positions-table">
      <thead>
        <tr>
          <th>Ticker</th>
          <th>Quantity</th>
          <th>Avg Cost</th>
          <th>Current Price</th>
          <th>Market Value</th>
          <th>Unrealized P&L</th>
          <th>% Return</th>
        </tr>
      </thead>
      <tbody>
        ${positions.map(pos => {
          const marketValue = pos.quantity * (pos.current_price || pos.avg_cost);
          const costBasis = pos.quantity * pos.avg_cost;
          const unrealizedPnl = marketValue - costBasis;
          const percentReturn = ((unrealizedPnl / costBasis) * 100);
          
          return `
            <tr>
              <td class="investment-ticker">${pos.ticker}</td>
              <td>${pos.quantity}</td>
              <td>$${pos.avg_cost.toFixed(2)}</td>
              <td>$${(pos.current_price || pos.avg_cost).toFixed(2)}</td>
              <td>$${marketValue.toLocaleString()}</td>
              <td class="investment-pnl ${unrealizedPnl >= 0 ? 'positive' : 'negative'}">
                $${unrealizedPnl.toLocaleString()}
              </td>
              <td class="investment-pnl ${percentReturn >= 0 ? 'positive' : 'negative'}">
                ${percentReturn.toFixed(2)}%
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
  
  container.innerHTML = tableHtml;
}

function renderRecentTrades(trades) {
  const container = document.getElementById('recent-trades');
  
  if (!trades || trades.length === 0) {
    container.innerHTML = '<div class="dash-empty">No recent trades</div>';
    return;
  }
  
  const tradesHtml = trades.map(trade => {
    const date = new Date(trade.executed_at).toLocaleDateString();
    const time = new Date(trade.executed_at).toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    
    return `
      <div class="investment-trade-item">
        <div class="investment-trade-header">
          <span class="investment-ticker">${trade.ticker}</span>
          <span class="investment-trade-action ${trade.action}">${trade.action.toUpperCase()}</span>
          <span class="investment-trade-date">${date} ${time}</span>
        </div>
        <div class="investment-trade-details">
          ${trade.quantity} shares @ $${trade.price.toFixed(2)} = $${trade.total.toLocaleString()}
        </div>
        ${trade.thesis ? `<div class="investment-trade-thesis">${trade.thesis}</div>` : ''}
      </div>
    `;
  }).join('');
  
  container.innerHTML = tradesHtml;
}

// Export the main render function for the dashboard system
window.renderInvestmentDashboard = renderInvestmentDashboard;