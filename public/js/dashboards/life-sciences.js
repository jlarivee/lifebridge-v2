// public/js/dashboards/life-sciences.js
// Life Sciences Account dashboard logic

async function renderAccountDashboard(el) {
  var accounts = ['Pfizer', 'BMS', 'Novartis', 'Lilly', 'Cigna', 'Elevance'];
  var accountCards = '';
  for (var i = 0; i < accounts.length; i++) {
    accountCards += '<div class="dash-account-card" onclick="dashAccountBrief(\'' + accounts[i] + '\')">' +
      '<div class="dash-account-name">' + accounts[i] + '</div>' +
      '<div class="dash-account-meta">Click for briefing</div>' +
    '</div>';
  }

  el.innerHTML = '<div class="dash-header"><div class="dash-title">Life Sciences Account Intelligence</div><div class="dash-subtitle">Work &mdash; Pharma &amp; Payer Accounts</div></div>' +
    '<div class="dash-actions"><button class="dash-btn" onclick="dashAccountNew()">New Briefing</button></div>' +
    '<div class="dash-cols">' +
      '<div>' +
        '<div class="dash-section-label">Recent Requests</div>' +
        '<div id="dashAccountRequests"><div class="dash-loading">Loading...</div></div>' +
      '</div>' +
      '<div>' +
        '<div class="dash-section-label">Accounts</div>' +
        '<div class="dash-account-grid">' + accountCards + '</div>' +
      '</div>' +
    '</div>' +
    dashChatHtml('life-sciences-account-agent');

  try {
    var logs = await getRecentLogs(10);
    var reqList = document.getElementById('dashAccountRequests');
    var filtered = (Array.isArray(logs) ? logs : []).filter(function(l) {
      return l.routed_to === 'life-sciences-account-agent' || (l.domain || '').toLowerCase() === 'work';
    }).slice(0, 10);
    if (filtered.length === 0) {
      reqList.innerHTML = '<div class="dash-empty">No recent account requests.</div>';
      return;
    }
    var html = '';
    for (var j = 0; j < filtered.length; j++) {
      var r = filtered[j];
      html += '<div class="dash-card"><div class="dash-card-title">' + escapeHtml((r.input || '').substring(0, 60)) + '</div>' +
        '<div class="dash-card-meta">' + escapeHtml(r.created_at || r.timestamp || '') + '</div></div>';
    }
    reqList.innerHTML = html;
  } catch {
    document.getElementById('dashAccountRequests').innerHTML = '<div class="dash-empty">No recent logs available.</div>';
  }
}

function dashAccountBrief(account) {
  var input = document.getElementById('dashChatInput');
  input.value = 'Give me a full account briefing for ' + account;
  input.focus();
}

function dashAccountNew() {
  var input = document.getElementById('dashChatInput');
  input.value = '';
  input.focus();
  input.placeholder = 'e.g., Prepare Novartis meeting brief for next Tuesday...';
}
