// public/js/dashboards/dashboard-shell.js
// Dashboard shell: open, chat widget, and chat send logic

// Dynamic agent CSS loader — loads agent-specific CSS from /css/agents/{name}.css
function loadAgentCSS(agentName) {
  var id = 'agent-css-' + agentName;
  if (document.getElementById(id)) return; // already loaded
  var link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = '/css/agents/' + agentName + '.css';
  link.onerror = function() { this.remove(); }; // silently remove if no agent CSS exists
  document.head.appendChild(link);
}

function openDashboard(agentName) {
  currentDashboardAgent = agentName;
  var el = document.getElementById('dashboardContent');
  el.innerHTML = '<div class="dash-loading">Loading dashboard...</div>';
  navigateTo('dashboard');

  // Load agent-specific CSS (silently fails if no file exists)
  loadAgentCSS(agentName);

  var renderers = {
    'morning-briefing-agent': renderBriefingDashboard,
    'life-sciences-account-agent': renderAccountDashboard,
    'travel-agent': renderTravelDashboard,
    'slab-inventory-tracker-agent': renderSlabDashboard,
    'memory-consolidation-agent': renderMemoryDashboard,
    'investment-research-agent': renderInvestmentDashboard,
    'italy2026': renderItaly2026Dashboard
  };

  var renderer = renderers[agentName];
  if (renderer) {
    renderer(el);
  } else {
    el.innerHTML = '<div class="dash-empty">No dashboard available for this agent.</div>';
  }
}

function dashChatHtml(agentName) {
  return '<div class="dash-chat">' +
    '<div class="dash-chat-label">Send a Request</div>' +
    '<div class="dash-chat-output" id="dashChatOutput"></div>' +
    '<div class="dash-chat-input-wrap">' +
      '<textarea class="dash-chat-input" id="dashChatInput" placeholder="Type a request..." rows="1" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();dashChatSend();}"></textarea>' +
      '<button class="dash-chat-send" id="dashChatSendBtn" onclick="dashChatSend()">' +
        '<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5l7 7-7 7"/></svg>' +
      '</button>' +
    '</div>' +
  '</div>';
}

async function dashChatSend() {
  var input = document.getElementById('dashChatInput');
  var output = document.getElementById('dashChatOutput');
  var btn = document.getElementById('dashChatSendBtn');
  var text = input.value.trim();
  if (!text) return;

  btn.disabled = true;
  input.disabled = true;
  output.innerHTML = '<div class="dash-loading">Processing...</div>' + output.innerHTML;

  try {
    var endpoint = AGENT_ENDPOINTS[currentDashboardAgent] || ('/agents/' + currentDashboardAgent);
    var data = await postToAgent(endpoint, text);
    var responseText = typeof data.output === 'string' ? data.output : JSON.stringify(data.output, null, 2);
    output.innerHTML = '<div class="dash-chat-response">' + escapeHtml(responseText) + '</div>' + output.innerHTML.replace('<div class="dash-loading">Processing...</div>', '');
  } catch (e) {
    output.innerHTML = '<div class="dash-chat-response" style="border-color:var(--color-error);">Error: ' + escapeHtml(e.message) + '</div>' + output.innerHTML.replace('<div class="dash-loading">Processing...</div>', '');
  }

  input.value = '';
  btn.disabled = false;
  input.disabled = false;
  input.focus();
}
