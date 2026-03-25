async function loadIntel() { await loadIntelSources(); await loadIntelFindings(); }

async function loadIntelSources() {
  var el = document.getElementById('intelSources');
  if (!el) return;
  try {
    var sources = await getIntelSources();
    var html = '';
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      var ok = s.consecutive_failures === 0;
      var color = ok ? '#22c55e' : '#ef4444';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border-subtle);font-family:var(--font-mono);font-size:10px;">';
      html += '<div style="display:flex;align-items:center;gap:6px;"><span style="width:6px;height:6px;border-radius:50%;background:' + color + ';display:inline-block;"></span><span style="color:var(--text-secondary);">' + escapeHtml(s.name) + '</span></div>';
      html += '<span style="color:var(--text-tertiary);">' + (s.last_scanned_at ? new Date(s.last_scanned_at).toLocaleString() : 'never') + '</span>';
      html += '</div>';
    }
    el.innerHTML = html;
  } catch {}
}

async function loadIntelFindings(statusFilter) {
  var el = document.getElementById('intelFindings');
  if (!el) return;
  try {
    var findings = await getIntelFindings(statusFilter);
    if (!findings.length) { el.innerHTML = '<div style="color:var(--text-tertiary);font-family:var(--font-mono);font-size:11px;padding:20px 0;text-align:center;">No findings yet. Run a scan.</div>'; return; }
    var html = '';
    for (var i = 0; i < findings.length; i++) {
      var f = findings[i];
      var sc = f.relevance_score;
      var scoreColor = sc >= 9 ? '#22c55e' : sc >= 6 ? '#14b8a6' : '#666';
      var statusColor = f.status === 'approved' ? '#22c55e' : f.status === 'rejected' ? '#666' : f.status === 'proposed' ? '#f59e0b' : '#14b8a6';
      html += '<div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;padding:12px 14px;margin-bottom:8px;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">';
      html += '<span style="font-family:var(--font-mono);font-size:12px;color:var(--text-primary);font-weight:600;">' + escapeHtml(f.title) + '</span>';
      html += '<div style="display:flex;gap:6px;">';
      html += '<span style="font-family:var(--font-mono);font-size:9px;padding:2px 6px;border-radius:3px;background:' + scoreColor + '22;color:' + scoreColor + ';">' + sc + '/10</span>';
      html += '<span style="font-family:var(--font-mono);font-size:9px;padding:2px 6px;border-radius:3px;background:' + statusColor + '22;color:' + statusColor + ';">' + f.status + '</span>';
      html += '</div></div>';
      html += '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-tertiary);margin-bottom:4px;">' + escapeHtml(f.source) + ' \u00b7 ' + escapeHtml(f.category) + '</div>';
      html += '<div style="font-size:12px;color:var(--text-secondary);line-height:1.5;">' + escapeHtml(f.summary) + '</div>';
      if (f.suggested_action) html += '<div style="font-family:var(--font-mono);font-size:10px;color:var(--amber);margin-top:6px;">' + escapeHtml(f.suggested_action) + '</div>';
      if (f.status === 'surfaced' || f.status === 'proposed') {
        html += '<div style="display:flex;gap:6px;margin-top:8px;">';
        html += '<button onclick="approveIntel(\'' + f.id + '\')" style="font-family:var(--font-mono);font-size:10px;padding:3px 10px;border-radius:4px;border:1px solid #22c55e;background:transparent;color:#22c55e;cursor:pointer;">Approve</button>';
        html += '<button onclick="rejectIntel(\'' + f.id + '\')" style="font-family:var(--font-mono);font-size:10px;padding:3px 10px;border-radius:4px;border:1px solid var(--border-subtle);background:transparent;color:var(--text-tertiary);cursor:pointer;">Reject</button>';
        html += '</div>';
      }
      html += '</div>';
    }
    el.innerHTML = html;
  } catch (e) { el.innerHTML = '<div style="color:#ef4444;font-family:var(--font-mono);font-size:11px;">' + escapeHtml(e.message) + '</div>'; }
}

async function runIntelScan() {
  var btn = document.getElementById('runIntelBtn');
  btn.textContent = 'Scanning...'; btn.disabled = true;
  try {
    var result = await apiRunIntelScan();
    btn.textContent = result.findings_count + ' found';
    setTimeout(function() { btn.textContent = 'Run Scan'; btn.style.color = '#000'; btn.disabled = false; }, 3000);
    loadIntel();
  } catch { btn.textContent = 'Failed'; btn.style.color = '#ef4444'; btn.disabled = false; }
}

async function approveIntel(id) {
  try { await approveIntelFinding(id); loadIntelFindings(); } catch {}
}

async function rejectIntel(id) {
  try { await rejectIntelFinding(id); loadIntelFindings(); } catch {}
}
