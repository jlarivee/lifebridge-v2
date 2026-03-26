// public/js/dashboards/investment.js
// Investment Research Agent dashboard logic

async function renderInvestmentDashboard(el) {
  el.innerHTML = '<div class="dash-header"><div class="dash-title">Investment Research</div><div class="dash-subtitle">Personal Life &mdash; Paper Trading &amp; Research</div></div>' +
    '<div class="dash-actions">' +
      '<button class="dash-btn" onclick="dashInvestResearch()">Research Ticker</button>' +
      '<button class="dash-btn" onclick="dashInvestPortfolio()">Portfolio</button>' +
      '<button class="dash-btn" onclick="dashInvestWatchlist()">Watchlist</button>' +
      '<button class="dash-btn" onclick="dashInvestTrades()">Trade History</button>' +
    '</div>' +
    '<div class="dash-section-label">Portfolio Summary</div>' +
    '<div id="dashInvestSummary"><div class="dash-loading">Loading...</div></div>' +
    dashChatHtml('investment-research-agent');

  try {
    var resp = await fetch('/investment/summary');
    var data = await resp.json();
    var s = data.output;
    var summaryEl = document.getElementById('dashInvestSummary');
    if (s) {
      var html = '<div class="dash-card"><div class="dash-card-body">' +
        '<div><strong>Portfolio Value:</strong> $' + (s.portfolio_value || 0).toLocaleString() + '</div>' +
        '<div><strong>Cash:</strong> $' + (s.cash || 0).toLocaleString() + '</div>' +
        '<div><strong>Positions:</strong> ' + (s.positions_count || 0) + '</div>' +
        '<div><strong>Watchlist:</strong> ' + (s.watchlist_count || 0) + ' tickers' + (s.tickers && s.tickers.length > 0 ? ' (' + s.tickers.join(', ') + ')' : '') + '</div>' +
        '<div><strong>Trades:</strong> ' + (s.open_trades || 0) + ' open, ' + (s.closed_trades || 0) + ' closed</div>' +
        (s.win_rate !== null ? '<div><strong>Win Rate:</strong> ' + s.win_rate + '%</div>' : '') +
        '</div></div>';
      summaryEl.innerHTML = html;
    } else {
      summaryEl.innerHTML = '<div class="dash-empty">No portfolio data yet. Start by adding tickers to your watchlist.</div>';
    }
  } catch (e) {
    document.getElementById('dashInvestSummary').innerHTML = '<div class="dash-empty">Failed to load summary: ' + escapeHtml(e.message) + '</div>';
  }
}

function dashInvestResearch() {
  var input = document.getElementById('dashChatInput');
  input.value = '';
  input.focus();
  input.placeholder = 'e.g., Research NVDA, analyze semiconductor sector...';
}

function dashInvestPortfolio() {
  var input = document.getElementById('dashChatInput');
  input.value = 'Show my paper portfolio dashboard with P&L';
  dashChatSend();
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
