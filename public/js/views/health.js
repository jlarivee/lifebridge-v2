async function loadHealth() {
  await loadHealthAlerts();
  await loadHealthLatest();
  await loadHealthHistory();
}

async function loadHealthAlerts() {
  var el = document.getElementById('healthAlerts');
  if (!el) return;
  try {
    var alerts = await getIntegrityAlerts();
    if (!alerts.length) { el.innerHTML = ''; return; }
    var html = '';
    for (var i = 0; i < alerts.length; i++) {
      var a = alerts[i];
      html += '<div style="background:#ef444411;border:1px solid #ef444433;border-radius:6px;padding:10px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">';
      html += '<div style="font-family:var(--font-mono);font-size:11px;color:#ef4444;">\ud83d\udea8 Critical: ' + a.issue_count + ' issue(s) \u2014 ' + new Date(a.created_at).toLocaleString() + '</div>';
      html += '<button onclick="acknowledgeAlert(\'' + a.id + '\')" style="font-family:var(--font-mono);font-size:10px;padding:3px 8px;border-radius:4px;border:1px solid #ef4444;background:transparent;color:#ef4444;cursor:pointer;">Acknowledge</button>';
      html += '</div>';
    }
    el.innerHTML = html;
  } catch { el.innerHTML = ''; }
}

async function acknowledgeAlert(alertId) {
  try {
    await apiAcknowledgeAlert(alertId);
    loadHealth();
  } catch {}
}

async function loadHealthLatest() {
  var statusEl = document.getElementById('healthStatus');
  var agentsEl = document.getElementById('healthAgents');
  if (!statusEl) return;
  try {
    var report = await getLatestReport();
    if (report.status === 'no reports yet') {
      statusEl.innerHTML = '<div style="color:var(--text-tertiary);font-family:var(--font-mono);font-size:12px;padding:20px 0;text-align:center;">No scans yet. Run one above.</div>';
      agentsEl.innerHTML = '';
      return;
    }
    var color = report.status === 'healthy' ? '#22c55e' : report.status === 'degraded' ? '#f59e0b' : '#ef4444';
    statusEl.innerHTML = '<div style="background:' + color + '11;border:1px solid ' + color + '33;border-radius:8px;padding:14px 16px;margin-bottom:16px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;">' +
      '<span style="font-family:var(--font-mono);font-size:14px;font-weight:700;color:' + color + ';">' + report.status.toUpperCase() + '</span>' +
      '<span style="font-family:var(--font-mono);font-size:10px;color:var(--text-tertiary);">' + report.agents_healthy + '/' + report.agents_checked + ' healthy \u2014 ' + report.trigger + ' \u2014 ' + new Date(report.run_at).toLocaleString() + '</span>' +
      '</div>' +
      '<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary);margin-top:6px;">' + escapeHtml(report.summary) + '</div>' +
      '</div>';

    // Issues list
    var issues = report.issues || [];
    var html = '';
    if (issues.length > 0) {
      for (var i = 0; i < issues.length; i++) {
        var issue = issues[i];
        var ic = issue.severity === 'critical' ? '#ef4444' : '#f59e0b';
        html += '<div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-left:3px solid ' + ic + ';border-radius:6px;padding:10px 14px;margin-bottom:6px;">';
        html += '<div style="display:flex;justify-content:space-between;">';
        html += '<span style="font-family:var(--font-mono);font-size:12px;color:var(--text-primary);">' + escapeHtml(issue.agent_name) + '</span>';
        html += '<span style="font-family:var(--font-mono);font-size:10px;color:' + ic + ';">' + issue.severity + ': ' + issue.type + '</span>';
        html += '</div>';
        html += '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-tertiary);margin-top:4px;">' + escapeHtml(issue.detail) + '</div>';
        html += '<div style="font-family:var(--font-mono);font-size:10px;color:var(--amber);margin-top:2px;">' + escapeHtml(issue.recommended_action) + '</div>';
        html += '</div>';
      }
    }
    agentsEl.innerHTML = html;
  } catch (e) {
    statusEl.innerHTML = '<div style="color:#ef4444;font-family:var(--font-mono);font-size:11px;">' + escapeHtml(e.message) + '</div>';
  }
}

async function loadHealthHistory() {
  var el = document.getElementById('healthHistory');
  if (!el) return;
  try {
    var reports = await getIntegrityReports();
    if (!reports.length) { el.innerHTML = '<div style="color:var(--text-tertiary);font-family:var(--font-mono);font-size:11px;">No reports yet.</div>'; return; }
    var html = '';
    for (var i = 0; i < Math.min(reports.length, 10); i++) {
      var r = reports[i];
      var c = r.status === 'healthy' ? '#22c55e' : r.status === 'degraded' ? '#f59e0b' : '#ef4444';
      html += '<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border-subtle);font-family:var(--font-mono);font-size:10px;">';
      html += '<span style="color:' + c + ';">' + r.status + '</span>';
      html += '<span style="color:var(--text-tertiary);">' + r.agents_checked + ' agents, ' + r.issues.length + ' issues</span>';
      html += '<span style="color:var(--text-tertiary);">' + r.trigger + '</span>';
      html += '<span style="color:var(--text-tertiary);">' + new Date(r.run_at).toLocaleString() + '</span>';
      html += '</div>';
    }
    el.innerHTML = html;
  } catch {}
}

async function runIntegrityScan() {
  var btn = document.getElementById('runIntegrityBtn');
  btn.textContent = 'Scanning...'; btn.disabled = true;
  try {
    await apiRunIntegrityScan();
    btn.textContent = 'Done'; btn.style.color = '#22c55e';
    setTimeout(function() { btn.textContent = 'Run Scan'; btn.style.color = '#000'; btn.disabled = false; }, 2000);
    loadHealth();
  } catch (e) {
    btn.textContent = 'Failed'; btn.style.color = '#ef4444'; btn.disabled = false;
  }
}
