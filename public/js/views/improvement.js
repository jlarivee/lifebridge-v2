function openImprovePanel() {
  document.getElementById('improveOverlay').classList.add('visible');
  document.getElementById('improvePanel').classList.add('visible');
}

function closeImprovePanel() {
  document.getElementById('improveOverlay').classList.remove('visible');
  document.getElementById('improvePanel').classList.remove('visible');
}

function toggleSection(id, headerEl) {
  var el = document.getElementById(id);
  var arrow = headerEl.querySelector('.arrow');
  el.classList.toggle('open');
  arrow.classList.toggle('open');
}

async function handleImprove() {
  var btn = document.getElementById('improveRunBtn');
  var loading = document.getElementById('improveLoading');
  var errEl = document.getElementById('improveError');

  btn.disabled = true;
  loading.classList.add('visible');
  errEl.classList.remove('visible');

  try {
    var proposal = await runImprovement();
    renderProposal(proposal);
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.add('visible');
  } finally {
    btn.disabled = false;
    loading.classList.remove('visible');
  }
}

function confidenceBadgeClass(confStr) {
  var lower = (confStr || '').toLowerCase();
  if (lower.indexOf('high') !== -1) return 'badge-confidence-high';
  if (lower.indexOf('medium') !== -1) return 'badge-confidence-medium';
  return 'badge-confidence-low';
}

function parseProposalPatterns(text) {
  var match = text.match(/PATTERNS OBSERVED\s*\n([\s\S]*?)(?=\nPROPOSED CHANGES|\nOVERALL ASSESSMENT|$)/);
  if (!match) return [];
  return match[1].trim().split('\n').filter(function(l) { return l.trim(); }).map(function(l) { return l.replace(/^\d+[\.\)]\s*/, '').trim(); }).filter(Boolean);
}

function parseProposalAssessment(text) {
  var match = text.match(/OVERALL ASSESSMENT\s*\n([\s\S]*?)(?=\u2500{6,}|$)/);
  return match ? match[1].trim() : '';
}

function parseProposalChanges(text) {
  var changes = [];
  var parts = text.split(/Change\s*\[?\d+\]?\s*:/);
  if (parts.length <= 1) return changes;
  for (var i = 1; i < parts.length; i++) {
    var part = parts[i];
    var change = {};
    var fields = ['Type', 'Evidence', 'Current', 'Proposed', 'Reasoning', 'Risk', 'Confidence'];
    for (var j = 0; j < fields.length; j++) {
      var field = fields[j];
      var re = new RegExp('^[ \\t]*' + field + ':\\s*([\\s\\S]*?)(?=\\n[ \\t]*(?:Type|Evidence|Current|Proposed|Reasoning|Risk|Confidence|Change|OVERALL|$))', 'sm');
      var m = part.match(re);
      if (m) change[field.toLowerCase()] = m[1].trim();
    }
    if (Object.keys(change).length > 0) changes.push(change);
  }
  return changes;
}

function renderProposal(proposal) {
  var area = document.getElementById('proposalArea');
  if (proposal.status !== 'pending') return;

  var card = document.createElement('div');
  card.className = 'proposal-card';
  card.id = 'proposal-' + proposal.id;

  var date = new Date(proposal.timestamp).toLocaleDateString();
  var patterns = parseProposalPatterns(proposal.proposal);
  var assessment = parseProposalAssessment(proposal.proposal);
  var changes = parseProposalChanges(proposal.proposal);

  var html = '<div class="proposal-header">' + date + ' &mdash; ' + proposal.requests_reviewed + ' requests reviewed</div>';

  if (patterns.length) {
    html += '<ol class="patterns-list">';
    for (var i = 0; i < patterns.length; i++) html += '<li>' + escapeHtml(patterns[i]) + '</li>';
    html += '</ol>';
  }

  if (assessment) html += '<div class="assessment-text">' + escapeHtml(assessment) + '</div>';

  for (var ci = 0; ci < changes.length; ci++) {
    var c = changes[ci];
    var isApproved = (proposal.approved_changes || []).some(function(a) { return a.change_index === ci; });
    var isRejected = (proposal.rejected_changes || []).some(function(a) { return a.change_index === ci; });
    var stateClass = isApproved ? ' approved' : isRejected ? ' rejected' : '';
    var cid = 'change-' + proposal.id + '-' + ci;

    html += '<div class="change-card' + stateClass + '" id="' + cid + '">';
    html += '<div><span class="badge badge-type">' + escapeHtml(c.type || 'unknown') + '</span>';
    if (c.confidence) html += '<span class="badge ' + confidenceBadgeClass(c.confidence) + '">' + escapeHtml(c.confidence) + '</span>';
    html += '</div>';
    if (c.evidence) html += '<div class="change-field-label">Evidence</div><div class="change-field-text">' + escapeHtml(c.evidence) + '</div>';
    if (c.reasoning) html += '<div class="change-field-label">Reasoning</div><div class="change-field-text">' + escapeHtml(c.reasoning) + '</div>';
    if (c.risk) html += '<div class="change-field-label">Risk</div><div class="change-field-text">' + escapeHtml(c.risk) + '</div>';
    if (c.current || c.proposed) {
      html += '<div class="diff-columns"><div><div class="diff-label">Current</div><div class="diff-current">' + escapeHtml(c.current || '(none)') + '</div></div>';
      html += '<div><div class="diff-label">Proposed</div><div class="diff-proposed">' + escapeHtml(c.proposed || '(none)') + '</div></div></div>';
    }
    if (isApproved) html += '<div class="change-status" style="color:var(--color-success);">&#10003; Approved</div>';
    else if (isRejected) html += '<div class="change-status" style="color:var(--text-muted);">&#10007; Rejected</div>';
    else {
      html += '<div class="change-actions">';
      html += '<button class="btn-approve" onclick="handleApprove(\'' + proposal.id + '\', ' + ci + ', \'' + cid + '\')">Approve</button>';
      html += '<button class="btn-reject" onclick="handleReject(\'' + proposal.id + '\', ' + ci + ', \'' + cid + '\')">Reject</button>';
      html += '</div>';
    }
    html += '</div>';
  }

  card.innerHTML = html;
  area.prepend(card);
}

async function handleApprove(proposalId, changeIndex, cid) {
  try {
    await approveImprovement(proposalId, changeIndex);
    var el = document.getElementById(cid);
    el.classList.add('approved');
    var actions = el.querySelector('.change-actions');
    if (actions) actions.innerHTML = '<div class="change-status" style="color:var(--color-success);">&#10003; Approved</div>';
  } catch (e) { alert(e.message); }
}

async function handleReject(proposalId, changeIndex, cid) {
  try {
    await rejectImprovement(proposalId, changeIndex);
    var el = document.getElementById(cid);
    el.classList.add('rejected');
    var actions = el.querySelector('.change-actions');
    if (actions) actions.innerHTML = '<div class="change-status" style="color:var(--text-muted);">&#10007; Rejected</div>';
  } catch (e) { alert(e.message); }
}

async function loadContext() {
  try {
    var ctx = await getContext();
    var el = document.getElementById('contextSection');
    var prefs = ctx.preferences || [];
    var constraints = ctx.constraints || [];
    var patterns = ctx.learned_patterns || [];
    var html = '';
    html += '<div class="sub-list-header">Preferences (' + prefs.length + ')</div>';
    for (var i = 0; i < prefs.length; i++) {
      var p = prefs[i];
      html += '<div class="context-entry">' + escapeHtml(p.content || JSON.stringify(p)) + '<div class="context-meta">' + escapeHtml(p.source || '') + ' &mdash; ' + (p.added ? new Date(p.added).toLocaleDateString() : '') + '</div></div>';
    }
    html += '<div class="sub-list-header">Constraints (' + constraints.length + ')</div>';
    for (var j = 0; j < constraints.length; j++) {
      var co = constraints[j];
      html += '<div class="context-entry">' + escapeHtml(co.content || JSON.stringify(co)) + '<div class="context-meta">' + escapeHtml(co.source || '') + ' &mdash; ' + (co.added ? new Date(co.added).toLocaleDateString() : '') + '</div></div>';
    }
    html += '<div class="sub-list-header">Learned patterns (' + patterns.length + ')</div>';
    for (var k = 0; k < patterns.length; k++) {
      var lp = patterns[k];
      html += '<div class="context-entry">' + escapeHtml(lp.content || JSON.stringify(lp)) + '<div class="context-meta">' + escapeHtml(lp.source || '') + ' &mdash; ' + (lp.added ? new Date(lp.added).toLocaleDateString() : '') + '</div></div>';
    }
    if (!prefs.length && !constraints.length && !patterns.length) {
      html = '<div style="color:var(--text-muted);font-family:JetBrains Mono,monospace;font-size:11px;">No context entries yet.</div>';
    }
    el.innerHTML = html;
  } catch (e) {
    document.getElementById('contextSection').innerHTML = '<div class="output-error">' + escapeHtml(e.message) + '</div>';
  }
}

async function loadHistory() {
  try {
    var history = await getImprovementHistory();
    var el = document.getElementById('historySection');
    var html = '';
    var pendingCount = history.filter(function(h) { return h.status === 'pending'; }).length;

    if (pendingCount > 2) {
      html += '<div style="margin-bottom:10px;"><button onclick="handleDismissAll()" id="dismissAllBtn" style="font-family:JetBrains Mono,monospace;font-size:10px;padding:4px 10px;border-radius:4px;border:1px solid #ef4444;background:transparent;color:#ef4444;cursor:pointer;">Dismiss all ' + pendingCount + ' pending</button></div>';
    }
    if (!history.length) html = '<div style="color:var(--text-muted);font-family:JetBrains Mono,monospace;font-size:11px;">No improvement history yet.</div>';
    for (var i = 0; i < history.length; i++) {
      var h = history[i];
      var date = new Date(h.timestamp).toLocaleDateString();
      var statusClass = h.status === 'pending' ? 'status-pending' : h.status === 'dismissed' ? 'status-dismissed' : 'status-resolved';
      var changeCount = (h.approved_changes || []).length + (h.rejected_changes || []).length;
      var totalChanges = parseProposalChanges(h.proposal).length;
      html += '<div class="history-entry"><span>' + date + '</span><span class="status-badge ' + statusClass + '">' + h.status + '</span><span>' + changeCount + '/' + totalChanges + ' changes resolved</span></div>';
    }
    el.innerHTML = html;
    for (var j = 0; j < history.length; j++) {
      if (history[j].status === 'pending' && !document.getElementById('proposal-' + history[j].id)) {
        renderProposal(history[j]);
      }
    }
  } catch (e) {
    document.getElementById('historySection').innerHTML = '<div class="output-error">' + escapeHtml(e.message) + '</div>';
  }
}

async function handleDismissAll() {
  var btn = document.getElementById('dismissAllBtn');
  if (!btn) return;
  btn.textContent = 'Dismissing...';
  btn.disabled = true;
  try {
    var result = await dismissAllImprovements();
    btn.textContent = result.dismissed + ' dismissed';
    btn.style.color = '#22c55e';
    btn.style.borderColor = '#22c55e';
    // Clear proposal cards and reload
    document.getElementById('proposalArea').innerHTML = '';
    setTimeout(function() { loadHistory(); }, 1500);
  } catch (e) {
    btn.textContent = 'Failed';
    btn.disabled = false;
  }
}
