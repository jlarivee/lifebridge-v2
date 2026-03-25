function openAgentWorkspace(agentName) {
  currentAgent = agentName;
  document.getElementById('workspaceTitle').textContent = AGENT_LABELS[agentName] || agentName;
  document.getElementById('workspaceSubtitle').textContent = 'Spoke agent workspace';
  document.getElementById('workspaceOutput').innerHTML = '';
  document.getElementById('workspaceInput').value = '';

  var chipsEl = document.getElementById('workspaceChips');
  var chips = QUICK_ACTIONS[agentName] || [];
  var chipHtml = '';
  for (var i = 0; i < chips.length; i++) {
    chipHtml += '<button class="chip" onclick="fillChip(\'' + escapeHtml(chips[i]) + '\')">' + escapeHtml(chips[i]) + '</button>';
  }
  chipsEl.innerHTML = chipHtml;

  navigateTo('workspace');
  setTimeout(function() { document.getElementById('workspaceInput').focus(); }, 400);
}

async function handleHubRoute() {
  var input = document.getElementById('hubInput').value.trim();
  if (!input) return;

  var btn = document.getElementById('hubSubmitBtn');
  btn.disabled = true;

  currentRouteInput = input;

  navigateTo('routing');

  var container = document.getElementById('routingContainer');
  container.innerHTML =
    '<div class="routing-label">Processing Request</div>' +
    '<div class="routing-query">' + escapeHtml(input) + '</div>' +
    '<div class="routing-progress"><div class="routing-progress-bar"><div class="routing-progress-fill analyzing" id="routingProgressFill"></div></div></div>' +
    '<div class="routing-status-text" id="routingStatusText">Analyzing intent and selecting agent...</div>';

  try {
    var result = await postRoute(input);

    document.getElementById('hubInput').value = '';
    currentRouteResult = result;
    renderRoutingResult(result, input);
  } catch (e) {
    renderRoutingError(e.message, input);
  } finally {
    btn.disabled = false;
  }
}

function parseReasoning(text) {
  var lines = text.split('\n');
  var rStart = -1;
  var dividerCount = 0;
  var rEnd = -1;

  for (var i = 0; i < lines.length; i++) {
    if (rStart === -1 && lines[i].trim().startsWith('REASONING')) {
      rStart = i;
      dividerCount = 0;
      continue;
    }
    if (rStart >= 0 && lines[i].indexOf('\u2500\u2500\u2500\u2500\u2500\u2500') !== -1) {
      dividerCount++;
      if (dividerCount === 1) continue;
      if (dividerCount === 2) { rEnd = i; break; }
    }
  }

  if (rStart >= 0 && rEnd >= 0) {
    var reasoning = lines.slice(rStart, rEnd + 1).join('\n');
    var before = lines.slice(0, rStart).join('\n').trim();
    var after = lines.slice(rEnd + 1).join('\n').trim();
    var rest = (before + '\n' + after).trim();
    return { reasoning: reasoning, rest: rest };
  }

  return { reasoning: null, rest: text };
}

function confidenceColor(conf) {
  if (conf === null || conf === undefined) return '#44445a';
  if (conf >= 90) return '#22c55e';
  if (conf >= 70) return '#f59e0b';
  return '#ef4444';
}

function renderRoutingResult(result, userInput) {
  var container = document.getElementById('routingContainer');
  var isClarification = result.response.indexOf('CLARIFICATION REQUIRED') !== -1;
  var parsed = parseReasoning(result.response);
  var reasoning = parsed.reasoning;
  var rest = parsed.rest;
  var conf = result.confidence;

  var routeMatch = rest.match(/Route to:\s*(.+)/);
  var contextMatch = rest.match(/Context passed:\s*(.+)/);
  var routedAgent = routeMatch ? routeMatch[1].trim() : '';
  var routedContext = contextMatch ? contextMatch[1].trim() : '';
  // Check static map first, then fall back to convention: /agents/{agent-name}
  var agentEndpoint = AGENT_ENDPOINTS[routedAgent] || (routedAgent && routedAgent !== 'Claude-native' && !routedAgent.includes('BUILD BRIEF') ? '/agents/' + routedAgent : null);

  var confColor = '#666';
  var confLabel = 'Unknown';
  if (conf !== null && conf !== undefined) {
    if (conf >= 90) { confColor = '#22c55e'; confLabel = 'High confidence'; }
    else if (conf >= 70) { confColor = '#f59e0b'; confLabel = 'Medium confidence'; }
    else { confColor = '#ef4444'; confLabel = 'Low confidence'; }
  }

  var circumference = 2 * Math.PI * 20;
  var dashOffset = conf !== null ? circumference - (conf / 100) * circumference : circumference;

  var html = '';
  html += '<div class="routing-label">Routing Decision</div>';
  html += '<div class="routing-query">' + escapeHtml(userInput) + '</div>';

  html += '<div class="routing-progress"><div class="routing-progress-bar"><div class="routing-progress-fill complete"></div></div></div>';

  if (isClarification) {
    html += '<div class="routing-clarification">';
    html += '<div class="routing-clarification-label">Clarification Required</div>';
    html += '<div class="routing-clarification-text">' + escapeHtml(rest) + '</div>';
    html += '</div>';

    var fid = 'fb-' + Math.random().toString(36).slice(2);
    html += buildFeedbackRow(fid, result.id);

    html += '<div class="routing-actions">';
    html += '<button class="routing-cancel-btn" id="routingCancelBtn">Back to Hub</button>';
    html += '</div>';

    container.innerHTML = html;

    var cancelBtn = document.getElementById('routingCancelBtn');
    if (cancelBtn) cancelBtn.addEventListener('click', function() { navigateTo('hub'); });
    attachFeedbackListeners(container, result.id);
    return;
  }

  if (reasoning) {
    html += '<div class="routing-reasoning-card">';
    html += '<div class="routing-reasoning-header">Reasoning</div>';
    html += '<div class="routing-reasoning-text">' + escapeHtml(reasoning) + '</div>';
    html += '</div>';
  }

  if (conf !== null && conf !== undefined) {
    html += '<div class="routing-confidence">';
    html += '<div class="confidence-ring">';
    html += '<svg width="52" height="52" viewBox="0 0 52 52">';
    html += '<circle class="confidence-ring-bg" cx="26" cy="26" r="20"/>';
    html += '<circle class="confidence-ring-fill" cx="26" cy="26" r="20" stroke="' + confColor + '" stroke-dasharray="' + circumference + '" stroke-dashoffset="' + dashOffset + '"/>';
    html += '</svg>';
    html += '<div class="confidence-ring-value" style="color:' + confColor + '">' + conf + '</div>';
    html += '</div>';
    html += '<div class="confidence-info">';
    html += '<div class="confidence-label" style="color:' + confColor + '">' + confLabel + '</div>';
    html += '<div class="confidence-sublabel">Confidence score: ' + conf + '/100</div>';
    html += '</div>';
    html += '</div>';
  }

  if (agentEndpoint) {
    html += '<div class="routing-destination">';
    html += '<div class="routing-dest-icon"><svg viewBox="0 0 24 24"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg></div>';
    html += '<div>';
    html += '<div class="routing-dest-name">' + escapeHtml(AGENT_LABELS[routedAgent] || routedAgent) + '</div>';
    html += '<div class="routing-dest-label">Destination agent</div>';
    html += '</div>';
    html += '</div>';

    if (conf !== null && conf >= 90) {
      html += '<div class="routing-auto-text">High confidence — auto-proceeding to agent...</div>';
      container.innerHTML = html;
      setTimeout(function() {
        proceedToAgent(agentEndpoint, routedAgent, userInput, routedContext, conf, result.id);
      }, 1500);
      return;
    } else {
      html += '<div class="routing-actions">';
      html += '<button class="routing-proceed-btn" id="routingProceedBtn">Proceed</button>';
      html += '<button class="routing-cancel-btn" id="routingCancelBtn">Cancel</button>';
      html += '</div>';
    }
  } else {
    html += '<div class="routing-response-card">';
    html += '<div class="routing-reasoning-header">Response</div>';
    html += '<div class="routing-response-text">' + escapeHtml(rest) + '</div>';
    html += '</div>';

    var fid2 = 'fb-' + Math.random().toString(36).slice(2);
    html += buildFeedbackRow(fid2, result.id);

    html += '<div class="routing-actions">';
    html += '<button class="routing-cancel-btn" id="routingCancelBtn">Back to Hub</button>';
    html += '</div>';
  }

  container.innerHTML = html;

  var proceedBtn = document.getElementById('routingProceedBtn');
  if (proceedBtn) {
    proceedBtn.addEventListener('click', function() {
      proceedToAgent(agentEndpoint, routedAgent, userInput, routedContext, conf, result.id);
    });
  }

  var cancelBtn = document.getElementById('routingCancelBtn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', function() { navigateTo('hub'); });
  }

  attachFeedbackListeners(container, result.id);
}

function renderRoutingError(msg, userInput) {
  var container = document.getElementById('routingContainer');
  container.innerHTML =
    '<div class="routing-label">Error</div>' +
    '<div class="routing-query">' + escapeHtml(userInput) + '</div>' +
    '<div style="padding:20px;background:var(--color-error-dim);border:1px solid rgba(239,68,68,0.25);border-radius:var(--radius-md);margin-bottom:24px;">' +
    '<div style="font-family:JetBrains Mono,monospace;font-size:12px;color:var(--color-error);">' + escapeHtml(msg) + '</div></div>' +
    '<div class="routing-actions"><button class="routing-cancel-btn" id="routingCancelBtn">Back to Hub</button></div>';
  document.getElementById('routingCancelBtn').addEventListener('click', function() { navigateTo('hub'); });
}

function proceedToAgent(endpoint, agentName, userInput, contextStr, conf, requestId) {
  currentAgent = agentName;
  document.getElementById('workspaceTitle').textContent = AGENT_LABELS[agentName] || agentName;
  document.getElementById('workspaceSubtitle').textContent = 'Processing routed request';

  var chips = QUICK_ACTIONS[agentName] || [];
  var chipHtml = '';
  for (var i = 0; i < chips.length; i++) {
    chipHtml += '<button class="chip" onclick="fillChip(\'' + escapeHtml(chips[i]) + '\')">' + escapeHtml(chips[i]) + '</button>';
  }
  document.getElementById('workspaceChips').innerHTML = chipHtml;

  navigateTo('workspace');

  var outputArea = document.getElementById('workspaceOutput');
  var cardId = 'out-' + Math.random().toString(36).slice(2);
  var fbId = 'fb-' + Math.random().toString(36).slice(2);

  var card = document.createElement('div');
  card.className = 'output-card';
  card.id = cardId;
  card.innerHTML =
    '<div class="output-card-header">' +
    '<div class="output-card-query">' + escapeHtml(userInput) + '</div>' +
    '<div class="output-card-time">' + new Date().toLocaleTimeString() + '</div>' +
    '</div>' +
    '<div class="output-loading">' +
    '<div class="loading-dots"><span></span><span></span><span></span></div>' +
    'Agent running — searching for current signals...' +
    '</div>';
  outputArea.prepend(card);

  callAgent(endpoint, agentName, userInput, contextStr, conf, cardId, fbId, requestId);
}

async function callAgent(endpoint, agentName, userInput, contextStr, conf, cardId, fbId, requestId) {
  try {
    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 60000);

    var agentResult = await postToAgentRaw(endpoint, {
        input: userInput,
        context: { routing_context: contextStr, routed_by: 'master-agent', confidence: conf }
      }, controller.signal);
    clearTimeout(timeout);


    renderAgentOutput(cardId, fbId, agentResult, requestId);
  } catch (err) {
    var errMsg = err.name === 'AbortError' ? 'Agent timed out after 60 seconds' : err.message;
    var card = document.getElementById(cardId);
    if (card) {
      card.innerHTML = card.querySelector('.output-card-header').outerHTML +
        '<div class="output-card-body"><div class="output-error">Agent call failed — ' + escapeHtml(errMsg) + '</div></div>' +
        buildFeedbackRow(fbId, requestId);
      attachFeedbackListeners(card, requestId);
    }
  }
}

function renderAgentOutput(cardId, fbId, agentResult, requestId) {
  var card = document.getElementById(cardId);
  if (!card) return;

  var output = agentResult.output || 'No output';
  var sections = parseAgentOutput(output);

  var bodyHtml = '';

  if (agentResult.requires_approval) {
    bodyHtml += '<div class="output-approval-badge">&#9888; Requires approval before sending</div>';
  }

  if (sections.length > 1) {
    for (var i = 0; i < sections.length; i++) {
      bodyHtml += '<div class="output-section">';
      if (sections[i].title) {
        bodyHtml += '<div class="output-section-label">' + escapeHtml(sections[i].title) + '</div>';
      }
      bodyHtml += '<div class="output-text">' + escapeHtml(sections[i].content) + '</div>';
      bodyHtml += '</div>';
    }
  } else {
    bodyHtml += '<div class="output-text">' + escapeHtml(output) + '</div>';
  }

  card.innerHTML = card.querySelector('.output-card-header').outerHTML +
    '<div class="output-card-body">' + bodyHtml + '</div>' +
    buildFeedbackRow(fbId, requestId);
  attachFeedbackListeners(card, requestId);
}

function parseAgentOutput(text) {
  var lines = text.split('\n');
  var sections = [];
  var currentSection = { title: '', content: '' };

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var headerMatch = line.match(/^(?:#{1,3}\s+|[A-Z][A-Z\s&/]+:?\s*$|(?:─{4,}|═{4,}|━{4,}))/);

    if (headerMatch && line.replace(/[─═━#\s:]/g, '').length > 0) {
      if (currentSection.content.trim()) {
        sections.push({ title: currentSection.title, content: currentSection.content.trim() });
      }
      currentSection = { title: line.replace(/^#+\s*/, '').replace(/:?\s*$/, '').trim(), content: '' };
    } else if (line.match(/^[─═━]{4,}$/)) {
      continue;
    } else {
      currentSection.content += line + '\n';
    }
  }

  if (currentSection.content.trim()) {
    sections.push({ title: currentSection.title, content: currentSection.content.trim() });
  }

  return sections.length > 0 ? sections : [{ title: '', content: text }];
}

function buildFeedbackRow(fbId, requestId) {
  return '<div class="feedback-row" data-fb-id="' + fbId + '" data-request-id="' + escapeHtml(requestId) + '" id="' + fbId + '">' +
    '<button class="fb-btn fb-btn-good" data-action="accept">Looks good</button>' +
    '<button class="fb-btn fb-btn-bad" data-action="show-input">Something\'s wrong</button>' +
    '<div class="fb-inline" id="' + fbId + '-inline">' +
    '<input type="text" placeholder="What went wrong?" id="' + fbId + '-text">' +
    '<button data-action="reject">Submit</button>' +
    '</div>' +
    '</div>';
}

function attachFeedbackListeners(parentEl, fallbackRequestId) {
  var rows = parentEl.querySelectorAll('.feedback-row[data-fb-id]:not([data-bound])');
  rows.forEach(function(row) {
    row.setAttribute('data-bound', '1');
    var fbId = row.dataset.fbId;
    var reqId = row.dataset.requestId || fallbackRequestId;

    var goodBtn = row.querySelector('[data-action="accept"]');
    if (goodBtn) {
      goodBtn.addEventListener('click', function() { sendFeedback(reqId, 'accepted', '', fbId); });
    }

    var badBtn = row.querySelector('[data-action="show-input"]');
    if (badBtn) {
      badBtn.addEventListener('click', function() {
        var inline = document.getElementById(fbId + '-inline');
        if (inline) inline.classList.add('visible');
      });
    }

    var submitBtn = row.querySelector('[data-action="reject"]');
    if (submitBtn) {
      submitBtn.addEventListener('click', function() {
        var textInput = document.getElementById(fbId + '-text');
        sendFeedback(reqId, 'rejected', textInput ? textInput.value : '', fbId);
      });
    }
  });
}

async function sendFeedback(requestId, outcome, feedback, fid) {
  try {
    await postFeedback(requestId, outcome, feedback);
    var row = document.getElementById(fid);
    if (row) {
      row.innerHTML = '<div class="fb-recorded">&#10003; Feedback recorded</div>';
      setTimeout(function() { row.style.opacity = '0'; }, 2000);
    }
  } catch (e) {
    var row2 = document.getElementById(fid);
    if (row2) row2.innerHTML = '<div class="output-error">' + escapeHtml(e.message) + '</div>';
  }
}

async function handleWorkspaceSubmit() {
  var input = document.getElementById('workspaceInput').value.trim();
  if (!input || !currentAgent) return;

  var endpoint = AGENT_ENDPOINTS[currentAgent];
  if (!endpoint) return;

  var btn = document.getElementById('workspaceSubmitBtn');
  btn.disabled = true;
  document.getElementById('workspaceInput').value = '';

  var outputArea = document.getElementById('workspaceOutput');
  var cardId = 'out-' + Math.random().toString(36).slice(2);
  var fbId = 'fb-' + Math.random().toString(36).slice(2);

  var card = document.createElement('div');
  card.className = 'output-card';
  card.id = cardId;
  card.innerHTML =
    '<div class="output-card-header">' +
    '<div class="output-card-query">' + escapeHtml(input) + '</div>' +
    '<div class="output-card-time">' + new Date().toLocaleTimeString() + '</div>' +
    '</div>' +
    '<div class="output-loading">' +
    '<div class="loading-dots"><span></span><span></span><span></span></div>' +
    'Agent running — searching for current signals...' +
    '</div>';
  outputArea.prepend(card);

  try {
    var requestId = 'ws-' + Date.now();
    try {
      var routeResult = await postRoute(input);
      if (routeResult && routeResult.id) requestId = routeResult.id;
    } catch (routeErr) {}

    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 60000);

    var result = await postToAgentRaw(endpoint, { input: input, context: { routed_by: 'workspace-direct' } }, controller.signal);
    clearTimeout(timeout);

    renderAgentOutput(cardId, fbId, result, requestId);
    if (requestId.indexOf('ws-') === 0) {
      var fbRow = document.getElementById(fbId);
      if (fbRow) fbRow.style.display = 'none';
    }
  } catch (err) {
    var errMsg = err.name === 'AbortError' ? 'Agent timed out after 60 seconds' : err.message;
    var cardEl = document.getElementById(cardId);
    if (cardEl) {
      cardEl.innerHTML = cardEl.querySelector('.output-card-header').outerHTML +
        '<div class="output-card-body"><div class="output-error">Agent call failed — ' + escapeHtml(errMsg) + '</div></div>';
    }
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    if (currentView === 'hub' && document.activeElement === document.getElementById('hubInput')) {
      handleHubRoute();
    } else if (currentView === 'workspace' && document.activeElement === document.getElementById('workspaceInput')) {
      handleWorkspaceSubmit();
    }
  }
});
