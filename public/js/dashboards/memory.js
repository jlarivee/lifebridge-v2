// public/js/dashboards/memory.js
// Memory Consolidation dashboard logic

async function renderMemoryDashboard(el) {
  el.innerHTML = '<div class="dash-header"><div class="dash-title">Memory Consolidation</div><div class="dash-subtitle">System &mdash; Weekly Context Learning</div></div>' +
    '<div class="dash-actions"><button class="dash-btn" id="dashMemRunBtn" onclick="dashMemRun()">Run Consolidation Now</button></div>' +
    '<div class="dash-tabs">' +
      '<button class="dash-tab active" onclick="dashMemTab(\'proposals\',this)">Pending Proposals</button>' +
      '<button class="dash-tab" onclick="dashMemTab(\'facts\',this)">Current Facts</button>' +
      '<button class="dash-tab" onclick="dashMemTab(\'history\',this)">History</button>' +
    '</div>' +
    '<div class="dash-tab-content active" id="dashMemProposals"><div class="dash-loading">Loading...</div></div>' +
    '<div class="dash-tab-content" id="dashMemFacts"></div>' +
    '<div class="dash-tab-content" id="dashMemHistory"></div>' +
    dashChatHtml('memory-consolidation-agent');

  loadMemProposals();
}

function dashMemTab(tab, btn) {
  var tabs = document.querySelectorAll('.dash-tab');
  var contents = document.querySelectorAll('.dash-tab-content');
  tabs.forEach(function(t) { t.classList.remove('active'); });
  contents.forEach(function(c) { c.classList.remove('active'); });
  btn.classList.add('active');

  if (tab === 'proposals') {
    document.getElementById('dashMemProposals').classList.add('active');
    loadMemProposals();
  } else if (tab === 'facts') {
    document.getElementById('dashMemFacts').classList.add('active');
    loadMemFacts();
  } else if (tab === 'history') {
    document.getElementById('dashMemHistory').classList.add('active');
    loadMemHistory();
  }
}

async function loadMemProposals() {
  var container = document.getElementById('dashMemProposals');
  container.innerHTML = '<div class="dash-loading">Loading...</div>';
  try {
    var data = await getMemoryProposals();
    var proposals = Array.isArray(data.output) ? data.output : [];
    if (proposals.length === 0) {
      container.innerHTML = '<div class="dash-empty">No pending proposals.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < proposals.length; i++) {
      var p = proposals[i];
      html += '<div class="dash-card">' +
        '<div class="dash-card-title">' + escapeHtml(p.fact || '') + '</div>' +
        '<div class="dash-card-meta">' +
          '<span class="dash-badge dash-badge-' + (p.status || 'pending') + '">' + escapeHtml(p.status || 'pending') + '</span>' +
          ' &bull; Category: ' + escapeHtml(p.category || '') +
          ' &bull; Confidence: ' + (p.confidence || 0) + '%' +
        '</div>' +
        '<div class="dash-card-body">' + escapeHtml(p.evidence || '') + '</div>' +
        (p.status === 'pending' ? '<div class="dash-proposal-actions">' +
          '<button class="dash-btn dash-btn-success" onclick="dashMemApprove(\'' + escapeHtml(p.id) + '\')">Approve</button>' +
          '<button class="dash-btn dash-btn-danger" onclick="dashMemReject(\'' + escapeHtml(p.id) + '\')">Reject</button>' +
        '</div>' : '') +
      '</div>';
    }
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="dash-empty">Failed to load: ' + escapeHtml(e.message) + '</div>';
  }
}

async function loadMemFacts() {
  var container = document.getElementById('dashMemFacts');
  container.innerHTML = '<div class="dash-loading">Loading...</div>';
  try {
    var data = await getMemoryFacts();
    var ctx = data.output || {};
    var html = '';
    var sections = ['preferences', 'constraints', 'learned_patterns'];
    for (var s = 0; s < sections.length; s++) {
      var key = sections[s];
      var items = ctx[key] || [];
      html += '<div class="dash-section-label">' + key.replace(/_/g, ' ') + ' (' + items.length + ')</div>';
      if (items.length === 0) {
        html += '<div class="dash-empty">None yet.</div>';
      } else {
        for (var j = 0; j < items.length; j++) {
          var item = items[j];
          var fact = typeof item === 'string' ? item : (item.fact || item.description || JSON.stringify(item));
          html += '<div class="dash-card"><div class="dash-card-body">' + escapeHtml(fact) + '</div></div>';
        }
      }
    }
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="dash-empty">Failed to load: ' + escapeHtml(e.message) + '</div>';
  }
}

async function loadMemHistory() {
  var container = document.getElementById('dashMemHistory');
  container.innerHTML = '<div class="dash-loading">Loading...</div>';
  try {
    var data = await getMemoryHistory();
    var runs = Array.isArray(data.output) ? data.output : [];
    if (runs.length === 0) {
      container.innerHTML = '<div class="dash-empty">No consolidation runs yet.</div>';
      return;
    }
    var html = '<table class="dash-table"><thead><tr><th>Date</th><th>Trigger</th><th>Logs Analyzed</th><th>Proposals</th><th>Duration</th></tr></thead><tbody>';
    for (var i = 0; i < runs.length; i++) {
      var r = runs[i];
      html += '<tr><td>' + escapeHtml(r.run_at || '') + '</td>' +
        '<td>' + escapeHtml(r.trigger || '') + '</td>' +
        '<td>' + (r.log_entries_analyzed || 0) + '</td>' +
        '<td>' + (r.proposals_generated || 0) + '</td>' +
        '<td>' + (r.duration_ms ? (r.duration_ms + 'ms') : '-') + '</td></tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = '<div class="dash-empty">Failed to load: ' + escapeHtml(e.message) + '</div>';
  }
}

async function dashMemApprove(id) {
  try {
    await approveMemoryProposal(id);
    loadMemProposals();
  } catch (e) {
    alert('Approve failed: ' + e.message);
  }
}

async function dashMemReject(id) {
  var reason = prompt('Rejection reason (optional):');
  try {
    await rejectMemoryProposal(id, reason);
    loadMemProposals();
  } catch (e) {
    alert('Reject failed: ' + e.message);
  }
}

async function dashMemRun() {
  var btn = document.getElementById('dashMemRunBtn');
  btn.disabled = true;
  btn.textContent = 'Running...';
  try {
    var data = await apiRunMemoryConsolidation();
    var output = document.getElementById('dashChatOutput');
    output.innerHTML = '<div class="dash-chat-response">' + escapeHtml(typeof data.output === 'string' ? data.output : JSON.stringify(data.output, null, 2)) + '</div>';
    loadMemProposals();
  } catch (e) {
    alert('Consolidation failed: ' + e.message);
  }
  btn.disabled = false;
  btn.textContent = 'Run Consolidation Now';
}
