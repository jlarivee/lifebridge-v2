function stopLandscape() {
  if (landscapeAnim) {
    cancelAnimationFrame(landscapeAnim);
    landscapeAnim = null;
  }
}

function initLandscape() {
  stopLandscape();
  var canvas = document.getElementById('landscapeCanvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var dpr = window.devicePixelRatio || 1;
  var rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  var W = rect.width;
  var H = rect.height;
  var cx = W / 2;
  var cy = H / 2;

  var emptySlotNames = ['Research Agent', 'Comms Agent', 'Analytics Agent', 'Strategy Agent', 'Ops Agent', 'Finance Agent', 'Legal Agent'];

  getRegistry().then(function(registry) {
    landscapeRegistryData = registry;
    var agents = registry.agents || [];
    var totalSlots = Math.max(agents.length + 3, 6);
    if (totalSlots > 8) totalSlots = 8;
    var radius = Math.min(W, H) * 0.32;

    landscapeNodes = [];
    landscapeNodes.push({
      x: cx, y: cy,
      r: 42,
      name: 'Master Agent',
      domain: 'Hub — Route · Orchestrate',
      type: 'hub',
      patterns: ['Routing', 'Orchestration', 'Approval'],
      agentKey: null
    });

    for (var i = 0; i < totalSlots; i++) {
      var angle = -Math.PI / 2 + (2 * Math.PI * i) / totalSlots;
      var nx = cx + Math.cos(angle) * radius;
      var ny = cy + Math.sin(angle) * radius;
      var isAgent = i < agents.length;
      var a = isAgent ? agents[i] : null;
      landscapeNodes.push({
        x: nx, y: ny,
        r: 28,
        name: isAgent ? (AGENT_LABELS[a.name] || a.name) : emptySlotNames[i - agents.length] || 'Agent Slot',
        domain: isAgent ? (a.domain || 'General') : '— available —',
        type: isAgent ? 'spoke' : 'empty',
        patterns: isAgent ? (a.trigger_patterns || []).slice(0, 5) : [],
        agentKey: isAgent ? a.name : null
      });
    }

    landscapeParticles = [];
    for (var p = 0; p < 40; p++) {
      var spokeIdx = 1 + Math.floor(Math.random() * totalSlots);
      landscapeParticles.push({
        spoke: spokeIdx,
        t: Math.random(),
        speed: 0.002 + Math.random() * 0.004,
        dir: Math.random() > 0.5 ? 1 : -1,
        alpha: 0.3 + Math.random() * 0.5,
        size: 1.5 + Math.random() * 2
      });
    }

    var hoveredNode = null;
    var tooltip = document.getElementById('landscapeTooltip');

    canvas.onmousemove = function(e) {
      var br = canvas.getBoundingClientRect();
      var mx = e.clientX - br.left;
      var my = e.clientY - br.top;
      hoveredNode = null;
      for (var n = 0; n < landscapeNodes.length; n++) {
        var node = landscapeNodes[n];
        var dx = mx - node.x;
        var dy = my - node.y;
        if (Math.sqrt(dx * dx + dy * dy) < node.r + 8) {
          hoveredNode = node;
          break;
        }
      }
      if (hoveredNode) {
        canvas.style.cursor = hoveredNode.agentKey ? 'pointer' : 'default';
        document.getElementById('tooltipName').textContent = hoveredNode.name;
        document.getElementById('tooltipDomain').textContent = hoveredNode.domain;
        var patsHtml = '';
        var pats = hoveredNode.patterns || [];
        for (var pi = 0; pi < pats.length; pi++) {
          patsHtml += '<span class="landscape-tooltip-tag' + (hoveredNode.type === 'hub' ? ' hub' : '') + '">' + escapeHtml(pats[pi]) + '</span>';
        }
        document.getElementById('tooltipPatterns').innerHTML = patsHtml;
        tooltip.style.left = Math.min(e.clientX + 16, W - 220) + 'px';
        tooltip.style.top = (e.clientY - 20) + 'px';
        tooltip.classList.add('visible');
      } else {
        canvas.style.cursor = 'default';
        tooltip.classList.remove('visible');
      }
    };

    canvas.onmouseleave = function() {
      hoveredNode = null;
      tooltip.classList.remove('visible');
      canvas.style.cursor = 'default';
    };

    canvas.onclick = function(e) {
      var br = canvas.getBoundingClientRect();
      var mx = e.clientX - br.left;
      var my = e.clientY - br.top;
      for (var n = 0; n < landscapeNodes.length; n++) {
        var node = landscapeNodes[n];
        var dx = mx - node.x;
        var dy = my - node.y;
        if (Math.sqrt(dx * dx + dy * dy) < node.r + 8 && node.agentKey) {
          tooltip.classList.remove('visible');
          openAgentWorkspace(node.agentKey);
          return;
        }
      }
    };

    var time = 0;
    function draw() {
      time += 0.016;
      ctx.clearRect(0, 0, W, H);

      for (var i = 1; i < landscapeNodes.length; i++) {
        var spoke = landscapeNodes[i];
        var hub = landscapeNodes[0];

        ctx.beginPath();
        ctx.moveTo(hub.x, hub.y);
        ctx.lineTo(spoke.x, spoke.y);
        if (spoke.type === 'spoke') {
          var lineGrad = ctx.createLinearGradient(hub.x, hub.y, spoke.x, spoke.y);
          lineGrad.addColorStop(0, 'rgba(139, 124, 247, 0.25)');
          lineGrad.addColorStop(1, 'rgba(45, 212, 191, 0.25)');
          ctx.strokeStyle = lineGrad;
          ctx.lineWidth = 1.5;
        } else {
          ctx.strokeStyle = 'rgba(68, 68, 90, 0.2)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 6]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }

      for (var p = 0; p < landscapeParticles.length; p++) {
        var part = landscapeParticles[p];
        var spokeNode = landscapeNodes[part.spoke];
        if (!spokeNode || spokeNode.type !== 'spoke') continue;

        part.t += part.speed * part.dir;
        if (part.t > 1) { part.t = 1; part.dir = -1; }
        if (part.t < 0) { part.t = 0; part.dir = 1; }

        var hubN = landscapeNodes[0];
        var px = hubN.x + (spokeNode.x - hubN.x) * part.t;
        var py = hubN.y + (spokeNode.y - hubN.y) * part.t;

        var partAlpha = part.alpha * (0.5 + 0.5 * Math.sin(time * 3 + p));
        ctx.beginPath();
        ctx.arc(px, py, part.size, 0, Math.PI * 2);
        ctx.fillStyle = part.dir > 0 ? 'rgba(139, 124, 247, ' + partAlpha + ')' : 'rgba(45, 212, 191, ' + partAlpha + ')';
        ctx.fill();
      }

      for (var n = 0; n < landscapeNodes.length; n++) {
        var node = landscapeNodes[n];
        var isHover = hoveredNode === node;

        if (node.type === 'hub') {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
          ctx.fillStyle = isHover ? '#1c1a30' : '#13122a';
          ctx.fill();
          ctx.strokeStyle = isHover ? '#a99cf9' : '#8b7cf7';
          ctx.lineWidth = 2;
          ctx.stroke();

          ctx.fillStyle = '#f0f0f5';
          ctx.font = '600 11px JetBrains Mono';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('MASTER', node.x, node.y - 6);
          ctx.fillStyle = '#8b7cf7';
          ctx.font = '400 9px JetBrains Mono';
          ctx.fillText('HUB', node.x, node.y + 8);
        } else if (node.type === 'spoke') {
          if (isHover) {
            var sg = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, 44);
            sg.addColorStop(0, 'rgba(45, 212, 191, 0.1)');
            sg.addColorStop(1, 'rgba(45, 212, 191, 0)');
            ctx.beginPath();
            ctx.arc(node.x, node.y, 44, 0, Math.PI * 2);
            ctx.fillStyle = sg;
            ctx.fill();
          }
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
          ctx.fillStyle = isHover ? '#0f1f1d' : '#0c1614';
          ctx.fill();
          ctx.strokeStyle = isHover ? '#38e8d0' : '#2dd4bf';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.fillStyle = '#f0f0f5';
          ctx.font = '500 9px Inter';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          var shortName = node.name.length > 14 ? node.name.substring(0, 12) + '..' : node.name;
          ctx.fillText(shortName, node.x, node.y);
        } else {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
          ctx.fillStyle = '#0a0a0e';
          ctx.fill();
          ctx.setLineDash([3, 4]);
          ctx.strokeStyle = isHover ? '#555' : '#2a2a36';
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = '#44445a';
          ctx.font = '400 9px Inter';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(node.name.length > 14 ? node.name.substring(0, 12) + '..' : node.name, node.x, node.y);
        }
      }

      var orbitR = radius + 50;
      for (var o = 0; o < 20; o++) {
        var oa = time * 0.15 + (o * Math.PI * 2) / 20;
        var ox = cx + Math.cos(oa) * orbitR;
        var oy = cy + Math.sin(oa) * orbitR;
        var oAlpha = 0.08 + 0.06 * Math.sin(time * 2 + o);
        ctx.beginPath();
        ctx.arc(ox, oy, 1.2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(139, 124, 247, ' + oAlpha + ')';
        ctx.fill();
      }

      landscapeAnim = requestAnimationFrame(draw);
    }
    draw();
  }).catch(function(e) {
    console.error('Landscape load failed:', e);
  });
}

window.addEventListener('resize', function() {
  if (currentView === 'landscape') {
    initLandscape();
  }
});
