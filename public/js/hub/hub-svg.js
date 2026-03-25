// public/js/hub/hub-svg.js
// SVG utility functions for the hub visualization.
// Pure functions with zero external dependencies.

var SVG_NS = 'http://www.w3.org/2000/svg';

function createSvgEl(tag, attrs) {
  var el = document.createElementNS(SVG_NS, tag);
  if (attrs) {
    for (var key in attrs) {
      if (key === 'class') el.setAttribute('class', attrs[key]);
      else el.setAttribute(key, attrs[key]);
    }
  }
  return el;
}

function hexToRgba(hex, alpha) {
  hex = hex.replace('#', '');
  var r = parseInt(hex.substring(0, 2), 16);
  var g = parseInt(hex.substring(2, 4), 16);
  var b = parseInt(hex.substring(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
}

// ═══════════════════════════════════════════════════════════════════════════════
// SPOKE AGENTS (card grid view)
// Dependencies: getRegistry() (api.js), AGENT_ENDPOINTS/AGENT_LABELS/
//   DASHBOARD_AGENTS (config.js), escapeHtml/openDashboard/openAgentWorkspace (globals)
// ═══════════════════════════════════════════════════════════════════════════════

function loadSpokeAgents() {
  console.log('[LifeBridge] loadSpokeAgents called');
  var grid = document.getElementById('spokeGrid');
  if (!grid) { console.error('[LifeBridge] spokeGrid element not found'); return; }
  grid.innerHTML = '<div class="dash-loading" style="padding:20px;text-align:center;color:#666">Loading agents...</div>';
  getRegistry().then(function(registry) {
    console.log('[LifeBridge] Registry loaded:', (registry.agents || []).length, 'agents');
    var agents = registry.agents || [];
    grid.innerHTML = '';

    for (var i = 0; i < agents.length; i++) {
      var a = agents[i];
      var hasEndpoint = !!AGENT_ENDPOINTS[a.name];
      var card = document.createElement('div');
      card.className = 'spoke-card' + (hasEndpoint ? '' : ' spoke-card-disabled');
      card.dataset.agent = a.name;
      card.innerHTML =
        '<div class="spoke-card-icon"><svg viewBox="0 0 24 24"><path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/></svg></div>' +
        '<div class="spoke-card-name">' + escapeHtml(AGENT_LABELS[a.name] || a.name) + '</div>' +
        '<div class="spoke-card-domain">' + escapeHtml(a.domain || 'General') + '</div>' +
        '<div class="spoke-card-status"><span class="dot"></span> ' + escapeHtml(hasEndpoint ? (a.status || 'Active') : 'Coming soon') + '</div>';
      if (hasEndpoint) {
        card.addEventListener('click', function() {
          var name = this.dataset.agent;
          if (DASHBOARD_AGENTS[name]) {
            openDashboard(name);
          } else {
            openAgentWorkspace(name);
          }
        });
      }
      grid.appendChild(card);
    }

    var empty = document.createElement('div');
    empty.className = 'spoke-empty';
    empty.innerHTML = '<div class="spoke-empty-label">+ More agents coming</div>';
    grid.appendChild(empty);
  }).catch(function(e) {
    console.error('[LifeBridge] Failed to load registry:', e);
    grid.innerHTML = '<div style="padding:20px;text-align:center;color:#ef4444;font-family:JetBrains Mono,monospace;font-size:12px">Failed to load agents: ' + e.message + '</div>';
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// NESTED HUB SVG VISUALIZATION
// Dependencies: createSvgEl/hexToRgba (above), DOMAIN_MASTERS (config.js),
//   expandedDomains (state.js), toggleDomain/getExternalUrl (hub-interactions.js),
//   openDashboard (dashboard-shell.js), openAgentWorkspace (index.html global)
// ═══════════════════════════════════════════════════════════════════════════════

function renderNestedHub() {
  var svg = document.getElementById('nhubSvg');
  if (!svg) return;

  svg.innerHTML = '';

  var W = 900, H = 900;
  var cx = W / 2, cy = H / 2;
  var innerR = 210;
  var subR = 140;
  var startAngle = -90;
  var domainSpacing = 72;

  // ─── DEFS: filters & gradients ───
  var defs = createSvgEl('defs');

  // Master glow filter
  var mGlow = createSvgEl('filter', { id: 'masterGlow', x: '-50%', y: '-50%', width: '200%', height: '200%' });
  mGlow.appendChild(createSvgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '8', result: 'blur' }));
  mGlow.appendChild(createSvgEl('feFlood', { 'flood-color': '#6B5CE7', 'flood-opacity': '0.35', result: 'color' }));
  var comp1 = createSvgEl('feComposite', { in: 'color', in2: 'blur', operator: 'in', result: 'glow' });
  mGlow.appendChild(comp1);
  var merge1 = createSvgEl('feMerge');
  merge1.appendChild(createSvgEl('feMergeNode', { in: 'glow' }));
  merge1.appendChild(createSvgEl('feMergeNode', { in: 'SourceGraphic' }));
  mGlow.appendChild(merge1);
  defs.appendChild(mGlow);

  // Node glow filter per domain color
  var domColors = ['#FF9900', '#1D9E75', '#D85A30', '#534AB7', '#888780'];
  for (var ci = 0; ci < domColors.length; ci++) {
    var nGlow = createSvgEl('filter', { id: 'glow-' + ci, x: '-50%', y: '-50%', width: '200%', height: '200%' });
    nGlow.appendChild(createSvgEl('feGaussianBlur', { in: 'SourceGraphic', stdDeviation: '6', result: 'blur' }));
    nGlow.appendChild(createSvgEl('feFlood', { 'flood-color': domColors[ci], 'flood-opacity': '0.3', result: 'color' }));
    nGlow.appendChild(createSvgEl('feComposite', { in: 'color', in2: 'blur', operator: 'in', result: 'glow' }));
    var mergeN = createSvgEl('feMerge');
    mergeN.appendChild(createSvgEl('feMergeNode', { in: 'glow' }));
    mergeN.appendChild(createSvgEl('feMergeNode', { in: 'SourceGraphic' }));
    nGlow.appendChild(mergeN);
    defs.appendChild(nGlow);
  }

  // Gradient for each domain's pulse beam
  for (var gi = 0; gi < DOMAIN_MASTERS.length; gi++) {
    var grad = createSvgEl('linearGradient', { id: 'beam-' + gi, gradientUnits: 'userSpaceOnUse' });
    grad.appendChild(createSvgEl('stop', { offset: '0%', 'stop-color': DOMAIN_MASTERS[gi].color, 'stop-opacity': '0' }));
    grad.appendChild(createSvgEl('stop', { offset: '40%', 'stop-color': DOMAIN_MASTERS[gi].color, 'stop-opacity': '0.8' }));
    grad.appendChild(createSvgEl('stop', { offset: '60%', 'stop-color': '#fff', 'stop-opacity': '0.9' }));
    grad.appendChild(createSvgEl('stop', { offset: '100%', 'stop-color': DOMAIN_MASTERS[gi].color, 'stop-opacity': '0' }));
    defs.appendChild(grad);
  }

  svg.appendChild(defs);

  // ─── SUBTLE GRID RINGS (ambient) ───
  for (var gr = 1; gr <= 3; gr++) {
    svg.appendChild(createSvgEl('circle', {
      cx: cx, cy: cy, r: gr * 150,
      fill: 'none', stroke: '#ffffff', 'stroke-width': 0.3, opacity: 0.04
    }));
  }

  // ─── MASTER NODE ───
  var masterG = createSvgEl('g', { class: 'nhub-master' });

  // Outer pulse ring
  var pulseRing = createSvgEl('circle', {
    cx: cx, cy: cy, r: 58,
    fill: 'none', stroke: '#6B5CE7', 'stroke-width': 1.5, opacity: 0.15
  });
  pulseRing.style.animation = 'master-ring-pulse 3s ease-in-out infinite';
  masterG.appendChild(pulseRing);

  // Main circle with gradient fill
  masterG.appendChild(createSvgEl('circle', {
    cx: cx, cy: cy, r: 48,
    fill: 'rgba(107,92,231,0.12)', stroke: '#6B5CE7', 'stroke-width': 2,
    filter: 'url(#masterGlow)'
  }));

  // Inner ring
  masterG.appendChild(createSvgEl('circle', {
    cx: cx, cy: cy, r: 30,
    fill: 'none', stroke: '#6B5CE7', 'stroke-width': 0.5, opacity: 0.25
  }));

  // Labels
  var ml = createSvgEl('text', { x: cx, y: cy - 3, 'text-anchor': 'middle', fill: '#e0dff8', 'font-family': "'JetBrains Mono',monospace", 'font-size': '13', 'font-weight': '600', 'letter-spacing': '0.18em' });
  ml.textContent = 'MASTER';
  masterG.appendChild(ml);
  var msl = createSvgEl('text', { x: cx, y: cy + 14, 'text-anchor': 'middle', fill: '#6B5CE7', 'font-family': "'JetBrains Mono',monospace", 'font-size': '9', 'letter-spacing': '0.15em', opacity: '0.7' });
  msl.textContent = 'HUB';
  masterG.appendChild(msl);
  svg.appendChild(masterG);

  // ─── DOMAIN MASTERS + CONNECTIONS ───
  for (var d = 0; d < DOMAIN_MASTERS.length; d++) {
    var dm = DOMAIN_MASTERS[d];
    var angleDeg = startAngle + d * domainSpacing;
    var angleRad = angleDeg * Math.PI / 180;
    var dx = cx + innerR * Math.cos(angleRad);
    var dy = cy + innerR * Math.sin(angleRad);
    var isExp = expandedDomains[dm.id];

    // ── Connection beam: center → domain ──
    var baseLine = createSvgEl('line', {
      x1: cx, y1: cy, x2: dx, y2: dy,
      stroke: dm.color, 'stroke-width': 0.5, opacity: 0.15
    });
    svg.appendChild(baseLine);

    // Animated pulse dot along line
    var pulseDot = createSvgEl('circle', { r: 2.5, fill: dm.color, opacity: 0.7 });
    var motionPath = createSvgEl('animateMotion', {
      dur: (2.5 + d * 0.3) + 's', repeatCount: 'indefinite',
      path: 'M' + cx + ',' + cy + ' L' + dx + ',' + dy
    });
    pulseDot.appendChild(motionPath);
    svg.appendChild(pulseDot);

    // ── Domain master node ──
    var domG = createSvgEl('g', { class: 'nhub-domain' + (isExp ? ' nhub-domain-expanded' : '') });
    domG.dataset.domainId = dm.id;
    domG.style.cursor = 'pointer';

    // Hover ring (invisible, shown on CSS hover)
    domG.appendChild(createSvgEl('circle', {
      cx: dx, cy: dy, r: 44,
      fill: 'none', stroke: dm.color, 'stroke-width': 1,
      opacity: 0, class: 'nhub-hover-ring'
    }));

    // Main circle
    var domCirc = createSvgEl('circle', {
      cx: dx, cy: dy, r: 34,
      fill: hexToRgba(dm.color, isExp ? 0.20 : 0.08),
      stroke: dm.color, 'stroke-width': isExp ? 2 : 1.2,
      filter: isExp ? 'url(#glow-' + d + ')' : 'none'
    });
    domG.appendChild(domCirc);

    // Domain initial letter inside circle (just 1-2 chars)
    var initials = dm.label.charAt(0);
    if (dm.label.indexOf(' ') > 0) initials = dm.label.split(' ').map(function(w){return w.charAt(0);}).join('');
    var domInit = createSvgEl('text', {
      x: dx, y: dy + 5, 'text-anchor': 'middle',
      fill: dm.color, 'font-family': "'JetBrains Mono',monospace",
      'font-size': '14', 'font-weight': '600', 'letter-spacing': '0.05em', opacity: '0.9'
    });
    domInit.textContent = initials;
    domG.appendChild(domInit);

    // Label BELOW the circle
    var domLabel = createSvgEl('text', {
      x: dx, y: dy + 50, 'text-anchor': 'middle',
      fill: dm.color, 'font-family': "'JetBrains Mono',monospace",
      'font-size': '9', 'font-weight': '500', 'letter-spacing': '0.1em', opacity: '0.85'
    });
    domLabel.textContent = dm.label.toUpperCase();
    domG.appendChild(domLabel);

    // Active count below label
    var activeCount = dm.subs.filter(function(s) { return s.active; }).length;
    var countL = createSvgEl('text', {
      x: dx, y: dy + 62, 'text-anchor': 'middle',
      fill: dm.color, 'font-family': "'JetBrains Mono',monospace",
      'font-size': '7.5', opacity: '0.5', 'letter-spacing': '0.06em'
    });
    countL.textContent = activeCount + '/' + dm.subs.length + ' active';
    domG.appendChild(countL);

    // Click handler
    domG.addEventListener('click', (function(domId) {
      return function(e) { e.stopPropagation(); toggleDomain(domId); };
    })(dm.id));
    svg.appendChild(domG);

    // ── Sub-agent nodes (only if expanded) ──
    if (isExp) {
      var subCount = dm.subs.length;
      var fanAngles;
      if (subCount === 1) fanAngles = [0];
      else if (subCount === 2) fanAngles = [-28, 28];
      else if (subCount === 3) fanAngles = [-36, 0, 36];
      else fanAngles = [-42, -14, 14, 42];

      for (var s = 0; s < subCount; s++) {
        var sub = dm.subs[s];
        var subAngleDeg = angleDeg + fanAngles[s];
        var subAngleRad = subAngleDeg * Math.PI / 180;
        var sx = dx + subR * Math.cos(subAngleRad);
        var sy = dy + subR * Math.sin(subAngleRad);

        // Connection line with draw-in animation
        var sLine = createSvgEl('line', {
          x1: dx, y1: dy, x2: sx, y2: sy,
          stroke: dm.color, 'stroke-width': 0.6, opacity: 0.18,
          'stroke-dasharray': subR, 'stroke-dashoffset': subR
        });
        sLine.style.transition = 'stroke-dashoffset 0.4s ease-out';
        sLine.dataset.subLine = '1';
        svg.appendChild(sLine);
        // Trigger draw animation
        requestAnimationFrame(function(el) { return function() { el.style.strokeDashoffset = '0'; }; }(sLine));

        // Sub-agent node group
        var subG = createSvgEl('g', { class: 'nhub-sub-node' });
        subG.style.opacity = '0';
        subG.style.transform = 'scale(0.3)';
        subG.style.transformBox = 'fill-box';
        subG.style.transformOrigin = 'center';
        subG.style.transition = 'opacity 0.3s ease-out, transform 0.3s ease-out';
        subG.style.transitionDelay = (s * 0.06) + 's';

        var subColor = sub.external ? '#4A90D9' : dm.color;
        var nodeR = sub.active ? 16 : 13;

        if (sub.active) {
          subG.style.cursor = 'pointer';

          // Subtle glow circle behind
          subG.appendChild(createSvgEl('circle', {
            cx: sx, cy: sy, r: nodeR + 6,
            fill: hexToRgba(subColor, 0.06), stroke: 'none'
          }));

          // Main circle
          subG.appendChild(createSvgEl('circle', {
            cx: sx, cy: sy, r: nodeR,
            fill: hexToRgba(subColor, 0.15), stroke: subColor, 'stroke-width': 1
          }));

          // Tiny green status dot
          subG.appendChild(createSvgEl('circle', {
            cx: sx + nodeR - 2, cy: sy - nodeR + 2, r: 2.5,
            fill: '#22c55e', stroke: '#0A0A0F', 'stroke-width': 0.5
          }));

          // Click handler
          subG.addEventListener('click', (function(agentName, isExternal) {
            return function(e) {
              e.stopPropagation();
              if (isExternal) { var u = getExternalUrl(agentName); if (u) window.open(u, '_blank'); return; }
              if (DASHBOARD_AGENTS[agentName]) openDashboard(agentName);
              else openAgentWorkspace(agentName);
            };
          })(sub.name, sub.external));
        } else {
          // Coming soon - dashed, dim
          subG.style.cursor = 'default';
          subG.appendChild(createSvgEl('circle', {
            cx: sx, cy: sy, r: nodeR,
            fill: 'transparent', stroke: subColor,
            'stroke-width': 0.8, 'stroke-dasharray': '3 2', opacity: 0.35
          }));

          // Tooltip on hover
          subG.addEventListener('mouseenter', function(e) {
            var tip = document.getElementById('nhubTooltip');
            if (!tip) return;
            tip.textContent = 'Coming Soon';
            tip.style.display = 'block';
            tip.style.opacity = '1';
            tip.style.left = (e.clientX + 14) + 'px';
            tip.style.top = (e.clientY - 32) + 'px';
          });
          subG.addEventListener('mouseleave', function() {
            var tip = document.getElementById('nhubTooltip');
            if (tip) { tip.style.opacity = '0'; setTimeout(function() { tip.style.display = 'none'; }, 150); }
          });
        }

        // Label BELOW sub-agent node
        var sLabel = createSvgEl('text', {
          x: sx, y: sy + nodeR + 13, 'text-anchor': 'middle',
          fill: sub.active ? '#b0b0c0' : '#55556a',
          'font-family': "'JetBrains Mono',monospace",
          'font-size': '7.5', 'letter-spacing': '0.05em'
        });
        sLabel.textContent = sub.label.toUpperCase();
        subG.appendChild(sLabel);

        svg.appendChild(subG);

        // Animate in
        requestAnimationFrame(function(el) { return function() { el.style.opacity = '1'; el.style.transform = 'scale(1)'; }; }(subG));
      }
    }
  }
}
