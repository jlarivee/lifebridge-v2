// public/js/dashboards/[AGENT_SHORT_NAME].js
// [AGENT_LABEL] dashboard logic
//
// Pattern: render function builds HTML skeleton with loading states,
// then fetches data asynchronously and populates sections.
// Uses shared CSS classes from dashboard.css — no custom CSS needed
// unless agent requires unique visual elements.

async function render[AGENT_PASCAL_NAME]Dashboard(el) {
  el.innerHTML = '<div class="dash-header">' +
      '<div class="dash-title">[AGENT_LABEL]</div>' +
      '<div class="dash-subtitle">[DOMAIN] &mdash; [PURPOSE_SHORT]</div>' +
    '</div>' +
    '<div class="dash-actions">' +
      // Add quick-action buttons here:
      // '<button class="dash-btn" onclick="dashAction()">Action</button>' +
    '</div>' +
    '<div class="dash-section-label">Overview</div>' +
    '<div id="dash[AGENT_PASCAL_NAME]Summary">' +
      '<div class="dash-loading">Loading...</div>' +
    '</div>' +
    dashChatHtml('[AGENT_NAME]');

  // Load initial data
  try {
    var resp = await fetch('/agents/[AGENT_NAME]/health');
    if (resp.ok) {
      var data = await resp.json();
      var summaryEl = document.getElementById('dash[AGENT_PASCAL_NAME]Summary');
      summaryEl.innerHTML = '<div class="dash-card">' +
        '<div class="dash-card-body">' +
          '<div><strong>Status:</strong> ' + (data.status || 'Unknown') + '</div>' +
        '</div>' +
      '</div>';
    }
  } catch (e) {
    var el2 = document.getElementById('dash[AGENT_PASCAL_NAME]Summary');
    if (el2) el2.innerHTML = '<div class="dash-empty">Could not load data.</div>';
  }
}
