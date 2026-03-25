async function loadTests() {
  await loadTestWarnings();
  await loadTestSuites();
  await loadTestHistory();
}

async function loadTestWarnings() {
  var el = document.getElementById('testWarnings');
  if (!el) return;
  try {
    var warnings = await getTestWarnings();
    if (!warnings.length) { el.innerHTML = ''; return; }
    var html = '';
    for (var i = 0; i < warnings.length; i++) {
      var w = warnings[i];
      var color = w.reason === 'not_called_30_days' ? '#f59e0b' : '#ef4444';
      html += '<div style="background:' + color + '11;border:1px solid ' + color + '33;border-radius:6px;padding:10px 14px;margin-bottom:8px;font-family:var(--font-mono);font-size:11px;color:' + color + ';">';
      html += '\u26a0 ' + escapeHtml(w.recommended_action || w.reason);
      if (w.prior_avg && w.current_avg) html += ' (avg: ' + w.prior_avg + ' \u2192 ' + w.current_avg + ')';
      html += '</div>';
    }
    el.innerHTML = html;
  } catch { el.innerHTML = ''; }
}

async function loadTestSuites() {
  var el = document.getElementById('testSuitesList');
  if (!el) return;
  try {
    var suites = await getTestSuites();
    if (!suites.length) { el.innerHTML = '<div style="color:var(--text-tertiary);font-family:var(--font-mono);font-size:12px;padding:20px 0;text-align:center;">No test suites yet. Deploy an agent to create one.</div>'; return; }
    var html = '';
    for (var i = 0; i < suites.length; i++) {
      var s = suites[i];
      var cases = s.test_cases || [];
      var passed = cases.filter(function(c) { return c.last_status === 'pass'; }).length;
      var total = cases.length;
      var lastRun = cases.reduce(function(latest, c) { return c.last_run_at > (latest || '') ? c.last_run_at : latest; }, null);
      var statusColor = passed === total && total > 0 ? '#22c55e' : passed > 0 ? '#f59e0b' : total > 0 ? '#ef4444' : 'var(--text-tertiary)';
      var statusText = total === 0 ? 'No cases' : passed + '/' + total + ' pass';

      html += '<details style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;margin-bottom:8px;">';
      html += '<summary style="padding:12px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">';
      html += '<div style="display:flex;align-items:center;gap:10px;">';
      html += '<span style="width:8px;height:8px;border-radius:50%;background:' + statusColor + ';display:inline-block;"></span>';
      html += '<span style="font-family:var(--font-mono);font-size:13px;color:var(--text-primary);">' + escapeHtml(s.agent_name) + '</span>';
      html += '</div>';
      html += '<div style="display:flex;align-items:center;gap:12px;">';
      html += '<span style="font-family:var(--font-mono);font-size:10px;color:' + statusColor + ';">' + statusText + '</span>';
      if (lastRun) html += '<span style="font-family:var(--font-mono);font-size:10px;color:var(--text-tertiary);">' + new Date(lastRun).toLocaleDateString() + '</span>';
      html += '<button onclick="event.stopPropagation();runAgentTest(\'' + s.agent_name + '\', this)" style="font-family:var(--font-mono);font-size:10px;padding:3px 8px;border-radius:4px;border:1px solid var(--amber);background:transparent;color:var(--amber);cursor:pointer;">Run</button>';
      html += '</div></summary>';

      html += '<div style="padding:0 16px 12px;">';
      for (var j = 0; j < cases.length; j++) {
        var c = cases[j];
        var cColor = c.last_status === 'pass' ? '#22c55e' : c.last_status === 'fail' ? '#ef4444' : 'var(--text-tertiary)';
        html += '<div style="padding:6px 0;border-top:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;">';
        html += '<span style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary);max-width:70%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(c.input.slice(0, 80)) + '</span>';
        html += '<span style="font-family:var(--font-mono);font-size:10px;color:' + cColor + ';">' + (c.last_status || 'pending') + '</span>';
        html += '</div>';
      }
      html += '</div></details>';
    }
    el.innerHTML = html;
  } catch (e) { el.innerHTML = '<div style="color:#ef4444;font-family:var(--font-mono);font-size:11px;">' + escapeHtml(e.message) + '</div>'; }
}

async function loadTestHistory() {
  var el = document.getElementById('testRunHistory');
  if (!el) return;
  try {
    var runs = await getTestRuns();
    if (!runs.length) { el.innerHTML = '<div style="color:var(--text-tertiary);font-family:var(--font-mono);font-size:11px;">No test runs yet.</div>'; return; }
    var html = '';
    for (var i = 0; i < Math.min(runs.length, 20); i++) {
      var r = runs[i];
      var color = r.status === 'pass' ? '#22c55e' : r.status === 'fail' ? '#ef4444' : '#f59e0b';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border-subtle);font-family:var(--font-mono);font-size:10px;">';
      html += '<span style="color:var(--text-secondary);">' + escapeHtml(r.agent_name) + '</span>';
      html += '<span style="color:' + color + ';">' + r.status + (r.failure_type ? ' (' + r.failure_type + ')' : '') + '</span>';
      html += '<span style="color:var(--text-tertiary);">' + r.duration_ms + 'ms</span>';
      html += '<span style="color:var(--text-tertiary);">' + new Date(r.run_at).toLocaleTimeString() + '</span>';
      html += '</div>';
    }
    el.innerHTML = html;
  } catch {}
}

async function runAllTests() {
  var btn = document.getElementById('runAllTestsBtn');
  btn.textContent = 'Running...'; btn.disabled = true;
  try {
    var result = await apiRunAllTests();
    btn.textContent = result.passed + '/' + result.total_cases + ' passed';
    btn.style.color = result.failed === 0 ? '#22c55e' : '#ef4444';
    setTimeout(function() { btn.textContent = 'Run All Tests'; btn.style.color = '#000'; btn.disabled = false; }, 3000);
    loadTests();
  } catch (e) {
    btn.textContent = 'Failed'; btn.style.color = '#ef4444'; btn.disabled = false;
  }
}

async function runAgentTest(agentName, btn) {
  btn.textContent = '...'; btn.disabled = true;
  try {
    var result = await apiRunAgentTests(agentName);
    btn.textContent = result.passed + '/' + result.total + ' pass';
    btn.style.color = result.failed === 0 ? '#22c55e' : '#ef4444';
    setTimeout(function() { btn.textContent = 'Run'; btn.style.color = 'var(--amber)'; btn.disabled = false; }, 3000);
    loadTests();
  } catch {
    btn.textContent = 'Err'; btn.disabled = false;
  }
}
