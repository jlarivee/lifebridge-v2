// public/js/state.js
// LifeBridge global state
// Single source of truth for all mutable app state.

var currentView = 'hub';
var currentRouteResult = null;
var currentRouteInput = '';
var currentAgent = null;
var currentHubView = 'topology';
var currentDashboardAgent = null;
var expandedDomains = {};
var SVG_NS = 'http://www.w3.org/2000/svg';
var landscapeAnim = null;
var landscapeNodes = [];
var landscapeParticles = [];
var landscapeRegistryData = null;
