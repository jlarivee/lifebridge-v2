// public/js/dashboards/morning-briefing.js
// Morning Briefing dashboard logic

async function renderBriefingDashboard(el) {
  el.innerHTML = '<div class="dash-header"><div class="dash-title">Morning Briefing</div><div class="dash-subtitle">Daily system briefing &mdash; 7:30 AM UTC</div></div>' +
    '<div class="dash-actions">' +
      '<button class="dash-btn" onclick="dashBriefingRun()">Run Now</button>' +
      '<button class="dash-btn" onclick="dashBriefingPreview()">Preview</button>' +
    '</div>' +
    '<div class="dash-section-label">Recent Briefings</div>' +
    '<div id="dashBriefingList"><div class="dash-loading">Loading...</div></div>' +
    dashChatHtml('morning-briefing-agent');

  try {
    var history = await getBriefingHistory();
    var list = document.getElementById('dashBriefingList');
    var items = Array.isArray(history) ? history.slice(0, 7) : [];
    if (items.length === 0) {
      list.innerHTML = '<div class="dash-empty">No briefings yet.</div>';
      return;
    }
    var html = '';
    for (var i = 0; i < items.length; i++) {
      var b = items[i];
      var preview = (b.summary || 'No summary').substring(0, 200);
      html += '<div class="dash-card dash-card-expandable" onclick="dashExpandBriefing(\'' + escapeHtml(b.briefing_id) + '\',this)">' +
        '<div class="dash-card-title">' + escapeHtml(b.date || 'Unknown') + '</div>' +
        '<div class="dash-card-meta">Delivered via: ' + escapeHtml((b.delivered_via || []).join(', ') || 'none') + ' &bull; ' + escapeHtml(b.status || '') + '</div>' +
        '<div class="dash-card-body">' + escapeHtml(preview) + '</div>' +
        '<div class="dash-card-expand-toggle">Read full &rarr;</div>' +
      '</div>';
    }
    list.innerHTML = html;
  } catch (e) {
    document.getElementById('dashBriefingList').innerHTML = '<div class="dash-empty">Failed to load: ' + escapeHtml(e.message) + '</div>';
  }
}

async function dashExpandBriefing(id, card) {
  var body = card.querySelector('.dash-card-body');
  var toggle = card.querySelector('.dash-card-expand-toggle');
  if (card.dataset.expanded === 'true') {
    body.textContent = body.dataset.preview;
    toggle.innerHTML = 'Read full &rarr;';
    card.dataset.expanded = 'false';
    return;
  }
  toggle.textContent = 'Loading...';
  try {
    var data = await getLatestBriefing();
    var full = typeof data.output === 'string' ? data.output : JSON.stringify(data.output, null, 2);
    body.dataset.preview = body.textContent;
    body.textContent = full;
    toggle.innerHTML = 'Collapse &uarr;';
    card.dataset.expanded = 'true';
  } catch {
    toggle.textContent = 'Failed to load';
  }
}

async function dashBriefingRun() {
  if (!confirm('Run the full morning briefing now? This will send to Gmail and Slack.')) return;
  try {
    var data = await apiRunBriefing();
    var output = document.getElementById('dashChatOutput');
    output.innerHTML = '<div class="dash-chat-response">' + escapeHtml(typeof data.output === 'string' ? data.output : JSON.stringify(data.output, null, 2)) + '</div>';
  } catch (e) {
    alert('Failed: ' + e.message);
  }
}

async function dashBriefingPreview() {
  try {
    var data = await previewBriefing();
    var output = document.getElementById('dashChatOutput');
    output.innerHTML = '<div class="dash-chat-response">' + escapeHtml(typeof data.output === 'string' ? data.output : JSON.stringify(data.output, null, 2)) + '</div>';
  } catch (e) {
    alert('Preview failed: ' + e.message);
  }
}
