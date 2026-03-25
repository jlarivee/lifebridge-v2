// public/js/hub/hub-interactions.js
// Hub interaction handlers: expand/collapse, mobile view, external URLs.
// Dependencies: expandedDomains (state.js), DOMAIN_MASTERS/DASHBOARD_AGENTS (config.js),
//   renderNestedHub (hub-svg.js or index.html), openDashboard (dashboard-shell.js),
//   openAgentWorkspace (index.html)

function getExternalUrl(name) {
  if (name === 'italy2026') {
    return null; // Will be populated from connector
  }
  return null;
}

function toggleDomain(domId) {
  var wasExpanded = expandedDomains[domId];
  for (var key in expandedDomains) { expandedDomains[key] = false; }
  if (!wasExpanded) { expandedDomains[domId] = true; }
  renderNestedHub();
  if (typeof renderMobileHub === 'function') renderMobileHub();
}

function renderMobileHub() {
  var container = document.getElementById('hubMobileList');
  if (!container) return;
  container.innerHTML = '';

  for (var d = 0; d < DOMAIN_MASTERS.length; d++) {
    var dm = DOMAIN_MASTERS[d];
    var activeCount = dm.subs.filter(function(s) { return s.active; }).length;
    var isExpanded = expandedDomains[dm.id];

    // Domain header
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:0.5px solid #222;cursor:pointer;';
    header.innerHTML =
      '<div style="display:flex;align-items:center;gap:10px;">' +
        '<span style="width:10px;height:10px;border-radius:50%;background:' + dm.color + ';display:inline-block;"></span>' +
        '<span style="font:13px JetBrains Mono,monospace;color:' + dm.color + ';">' + dm.label.toUpperCase() + '</span>' +
        '<span style="font:9px JetBrains Mono,monospace;color:#666;background:#1a1a22;padding:2px 6px;border-radius:4px;">' + activeCount + '/' + dm.subs.length + '</span>' +
      '</div>' +
      '<span style="color:#666;font-size:12px;">' + (isExpanded ? '\u25BC' : '\u25B6') + '</span>';
    header.addEventListener('click', (function(domId) {
      return function() { toggleDomain(domId); renderMobileHub(); };
    })(dm.id));
    container.appendChild(header);

    // Sub-agent list
    if (isExpanded) {
      for (var s = 0; s < dm.subs.length; s++) {
        var sub = dm.subs[s];
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 0 10px 20px;' + (sub.active ? 'cursor:pointer;' : 'cursor:default;');
        row.innerHTML =
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span style="width:6px;height:6px;border-radius:50%;background:' + dm.color + ';display:inline-block;opacity:' + (sub.active ? '1' : '0.4') + ';"></span>' +
            '<span style="font:12px JetBrains Mono,monospace;color:' + (sub.active ? '#ccc' : '#555') + ';">' + sub.label.toUpperCase() + '</span>' +
          '</div>' +
          '<span style="font:8px JetBrains Mono,monospace;padding:2px 6px;border-radius:3px;' +
            (sub.active ? 'color:#22c55e;background:rgba(34,197,94,0.1);' : 'color:#666;background:#1a1a22;') +
          '">' + (sub.active ? 'ACTIVE' : 'SOON') + '</span>';
        if (sub.active) {
          row.addEventListener('click', (function(agentName, isExternal) {
            return function() {
              if (isExternal) { var u = getExternalUrl(agentName); if (u) window.open(u, '_blank'); return; }
              if (DASHBOARD_AGENTS[agentName]) openDashboard(agentName);
              else openAgentWorkspace(agentName);
            };
          })(sub.name, sub.external));
        }
        container.appendChild(row);
      }
    }
  }
}
