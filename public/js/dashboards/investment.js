// public/js/dashboards/investment.js
// Investment Research Agent dashboard logic

var _investRefreshInterval = null;

async function renderInvestmentDashboard(el) {
  el.innerHTML =
    '<div class="dash-header"><div class="dash-title">Investment Research</div>' +
    '<div class="dash-subtitle">Personal Life &mdash; Paper Trading &amp; Research</div></div>' +
    '<div class="dash-actions">' +
      '<button class="dash-btn" onclick="dashInvestRefresh()">Refresh</button>' +
      '<button class="dash-btn" onclick="dashInvestResearch()">Research Ticker</button>' +
      '<button class="dash-btn" onclick="dashInvestWatchlist()">Watchlist</button>' +
      '<button class="dash-btn" onclick="dashInvestTrades()">Trade History</button>' +
    '</div>' +
    '<div class="dash-section-label">Portfolio Positions</div>' +
    '<div id="dashInvestPositions"><div class="dash-loading">Loading positions...</div></div>' +
    '<div class="dash-section-label" style="margin-top:16px;">Portfolio Summary</div>' +
    '<div id="dashInvestSummary"><div class="dash-loading">Loading...</div></div>' +
    dashChatHtml('investment-research-agent');

  // Clear any previous auto-refresh
  if (_investRefreshInterval) {
    clearInterval(_investRefreshInterval);
    _investRefreshInterval = null;
  }

  loadInvestPositions();
  loadInvestSummary();

  // Auto-refresh positions every 60 seconds
  _investRefreshInterval = setInterval(function() {
    loadInvestPositions();
    loadInvestSummary();
  }, 60000);
}

async function loadInvestPositions() {
  var container = document.getElementById('dashInvestPositions');
  if (!container) return;
  try {
    var resp = await fetch('/investment/portfolio');
    var data = await resp.json();
    var portfolio = data.output;

    if (!portfolio || !portfolio.positions || portfolio.positions.length === 0) {
      container.innerHTML =
        '<div class="invest-summary-row">' +
          '<span>Cash: <strong>$' + (portfolio ? (portfolio.virtual_cash || 0).toLocaleString() : 0) + '</strong></span>' +
          '<span>Total Value: <strong>$' + (portfolio ? (portfolio.total_value || 0).toLocaleString() : 0) + '</strong></span>' +
        '</div>' +
        '<div class="dash-empty">No positions yet. Use the chat below to execute a paper trade.</div>';
      return;
    }

    var rows = portfolio.positions.map(function(p) {
      var currentPrice = p.current_price || p.avg_cost;
      var unrealizedPnl = (currentPrice - p.avg_cost) * p.quantity;
      var pnlClass = unrealizedPnl >= 0 ? 'invest-pnl-pos' : 'invest-pnl-neg';
      var pnlSign = unrealizedPnl >= 0 ? '+' : '';
      return '<tr>' +
        '<td class="invest-ticker">' + escapeHtml(p.ticker) + '</td>' +
        '<td>' + p.quantity + '</td>' +
        '<td>$' + p.avg_cost.toFixed(2) + '</td>' +
        '<td>$' + currentPrice.toFixed(2) + '</td>' +
        '<td class="' + pnlClass + '">' + pnlSign + '$' + unrealizedPnl.toFixed(2) + '</td>' +
      '</tr>';
    }).join('');

    var positionsValue = portfolio.positions.reduce(function(sum, p) {
      return sum + p.quantity * (p.current_price || p.avg_cost);
    }, 0);

    container.innerHTML =
      '<div class="invest-summary-row">' +
        '<span>Cash: <strong>$' + (portfolio.virtual_cash || 0).toLocaleString() + '</strong></span>' +
        '<span>Positions Value: <strong>$' + positionsValue.toLocaleString() + '</strong></span>' +
        '<span>Total: <strong>$' + (portfolio.total_value || 0).toLocaleString() + '</strong></span>' +
        '<span class="invest-refresh-time">Updated ' + new Date().toLocaleTimeString() + '</span>' +
      '</div>' +
      '<table class="invest-positions-table">' +
        '<thead><tr>' +
          '<th>Ticker</th><th>Qty</th><th>Avg Cost</th><th>Current</th><th>Unrealized P&amp;L</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';
  } catch(e) {
    var c = document.getElementById('dashInvestPositions');
    if (c) c.innerHTML = '<div class="dash-empty">Failed to load positions: ' + escapeHtml(e.message) + '</div>';
  }
}

async function loadInvestSummary() {
  var summaryEl = document.getElementById('dashInvestSummary');
  if (!summaryEl) return;
  try {
    var resp = await fetch('/investment/summary');
    var data = await resp.json();
    var s = data.output;
    if (s) {
      summaryEl.innerHTML =
        '<div class="dash-card"><div class="dash-card-body">' +
          '<div><strong>Watchlist:</strong> ' + (s.watchlist_count || 0) + ' tickers' +
            (s.tickers && s.tickers.length > 0 ? ' (' + escapeHtml(s.tickers.join(', ')) + ')' : '') + '</div>' +
          '<div><strong>Trades:</strong> ' + (s.open_trades || 0) + ' open, ' + (s.closed_trades || 0) + ' closed</div>' +
          (s.win_rate !== null && s.win_rate !== undefined ? '<div><strong>Win Rate:</strong> ' + s.win_rate + '%</div>' : '') +
        '</div></div>';
    } else {
      summaryEl.innerHTML = '<div class="dash-empty">No portfolio data yet.</div>';
    }
  } catch(e) {
    var el = document.getElementById('dashInvestSummary');
    if (el) el.innerHTML = '<div class="dash-empty">Failed to load summary.</div>';
  }
}

function dashInvestRefresh() {
  loadInvestPositions();
  loadInvestSummary();
}

function dashInvestResearch() {
  var input = document.getElementById('dashChatInput');
  input.value = '';
  input.focus();
  input.placeholder = 'e.g., Research NVDA, analyze semiconductor sector...';
}

function dashInvestWatchlist() {
  var input = document.getElementById('dashChatInput');
  input.value = 'Show my current watchlist with any price alerts';
  dashChatSend();
}

function dashInvestTrades() {
  var input = document.getElementById('dashChatInput');
  input.value = 'Show my trade history and performance stats';
  dashChatSend();
}
