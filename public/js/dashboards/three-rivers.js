// public/js/dashboards/three-rivers.js
// Three Rivers Slab dashboard logic

async function renderSlabDashboard(el) {
  el.innerHTML = '<div class="dash-header"><div class="dash-title">Three Rivers Slab</div><div class="dash-subtitle">Personal Business &mdash; Inventory Tracker</div></div>' +
    '<div class="dash-actions">' +
      '<button class="dash-btn" onclick="dashSlabAdd()">Add Slab</button>' +
      '<button class="dash-btn" onclick="dashSlabViewAll()">View All</button>' +
    '</div>' +
    '<div class="dash-section-label">Current Inventory</div>' +
    '<div id="dashSlabInventory"><div class="dash-loading">Loading...</div></div>' +
    dashChatHtml('slab-inventory-tracker-agent');

  try {
    var data = await postSlabRequest('show full inventory');
    var inv = document.getElementById('dashSlabInventory');
    var output = typeof data.output === 'string' ? data.output : JSON.stringify(data.output, null, 2);
    inv.innerHTML = '<div class="dash-card"><div class="dash-card-body">' + escapeHtml(output) + '</div></div>';
  } catch (e) {
    document.getElementById('dashSlabInventory').innerHTML = '<div class="dash-empty">Failed to load inventory: ' + escapeHtml(e.message) + '</div>';
  }
}

function dashSlabAdd() {
  var input = document.getElementById('dashChatInput');
  input.value = '';
  input.focus();
  input.placeholder = 'e.g., Add a walnut slab, 48x24x2.5, yard location A3...';
}

function dashSlabViewAll() {
  var input = document.getElementById('dashChatInput');
  input.value = 'Show full inventory with aging report';
  dashChatSend();
}
