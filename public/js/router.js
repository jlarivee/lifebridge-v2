// public/js/router.js
// LifeBridge navigation router
// ALL view transitions live here.

// View registry
var VIEW_MAP = {
  hub: 'viewHub',
  routing: 'viewRouting',
  workspace: 'viewWorkspace',
  landscape: 'viewLandscape',
  ideas: 'viewIdeas',
  tests: 'viewTests',
  health: 'viewHealth',
  intel: 'viewIntel',
  dashboard: 'viewDashboard'
};

function navigateTo(viewName, skipPush) {
  var views = document.querySelectorAll('.view');
  var backBtn = document.getElementById('backBtn');

  views.forEach(function(v) { v.classList.remove('active'); });

  var target = document.getElementById(VIEW_MAP[viewName]);
  if (target) {
    setTimeout(function() { target.classList.add('active'); }, 20);
  }

  backBtn.classList.toggle('visible', viewName !== 'hub');
  currentView = viewName;

  if (viewName === 'landscape') {
    setTimeout(initLandscape, 100);
  }
  if (viewName !== 'landscape') {
    stopLandscape();
  }
}

function switchHubView(mode) {
  currentHubView = mode;
  var topoContainer = document.getElementById('hubTopologyContainer');
  var gridContainer = document.getElementById('hubGridContainer');
  var topoBtn = document.getElementById('hubViewTopology');
  var gridBtn = document.getElementById('hubViewGrid');

  if (mode === 'topology') {
    topoContainer.style.display = '';
    gridContainer.style.display = 'none';
    topoBtn.classList.add('active');
    gridBtn.classList.remove('active');
    renderNestedHub();
  } else {
    topoContainer.style.display = 'none';
    gridContainer.style.display = '';
    topoBtn.classList.remove('active');
    gridBtn.classList.add('active');
  }
}
