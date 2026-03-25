// public/js/hub/hub.js
// Hub view orchestrator
// Called when hub view initializes.
// Dependencies: loadSpokeAgents/renderNestedHub (hub-svg.js),
//   renderMobileHub (hub-interactions.js)

function initHub() {
  loadSpokeAgents();
  renderNestedHub();
  renderMobileHub();
}
