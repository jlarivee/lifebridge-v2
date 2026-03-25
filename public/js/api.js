// public/js/api.js
// LifeBridge API layer
// ALL fetch() calls live here. Zero fetch() calls anywhere else.
// Every function returns a Promise.

async function apiFetch(url, opts) {
  opts = opts || {};
  var res = await fetch(url, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  var contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Server returned non-JSON response (HTTP ' + res.status + ') for ' + url);
  }
  var data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// ─── Core ───
async function getRegistry() {
  return apiFetch('/registry');
}

async function postRoute(input) {
  return apiFetch('/route', {
    method: 'POST',
    body: JSON.stringify({ input: input })
  });
}

async function postFeedback(requestId, outcome, feedback) {
  return apiFetch('/route/feedback', {
    method: 'POST',
    body: JSON.stringify({ request_id: requestId, outcome: outcome, feedback: feedback || '' })
  });
}

// ─── Agents ───
async function postToAgent(endpoint, request) {
  var res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request: request })
  });
  return res.json();
}

async function postToAgentRaw(endpoint, body, signal) {
  var res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal
  });
  var data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// ─── Improvement ───
async function runImprovement() {
  return apiFetch('/improve/run', { method: 'POST' });
}

async function approveImprovement(proposalId, changeIndex) {
  return apiFetch('/improve/approve', {
    method: 'POST',
    body: JSON.stringify({ proposal_id: proposalId, change_index: changeIndex })
  });
}

async function rejectImprovement(proposalId, changeIndex) {
  return apiFetch('/improve/reject', {
    method: 'POST',
    body: JSON.stringify({ proposal_id: proposalId, change_index: changeIndex })
  });
}

async function getContext() {
  return apiFetch('/context');
}

async function getImprovementHistory() {
  return apiFetch('/improve/history');
}

// ─── Ideas ───
async function getIdeas() {
  return apiFetch('/ideas');
}

async function createIdea(text) {
  return apiFetch('/ideas', { method: 'POST', body: JSON.stringify({ text: text }) });
}

async function updateIdea(id, text) {
  return apiFetch('/ideas/' + id, { method: 'PUT', body: JSON.stringify({ text: text }) });
}

async function deleteIdea(id) {
  return apiFetch('/ideas/' + id, { method: 'DELETE' });
}

async function sendIdea(id) {
  return apiFetch('/ideas/' + id + '/send', { method: 'POST' });
}

// ─── Tests ───
async function getTestWarnings() {
  return apiFetch('/test/warnings');
}

async function getTestSuites() {
  return apiFetch('/test/suites');
}

async function getTestRuns() {
  return apiFetch('/test/runs');
}

async function apiRunAllTests() {
  return apiFetch('/test/run', { method: 'POST' });
}

async function apiRunAgentTests(agentName) {
  return apiFetch('/test/run/' + agentName, { method: 'POST' });
}

// ─── Health / Integrity ───
async function getIntegrityAlerts() {
  return apiFetch('/integrity/alerts');
}

async function apiAcknowledgeAlert(alertId) {
  return apiFetch('/integrity/alerts/' + alertId + '/acknowledge', {
    method: 'POST', body: JSON.stringify({})
  });
}

async function getLatestReport() {
  return apiFetch('/integrity/reports/latest');
}

async function getIntegrityReports() {
  return apiFetch('/integrity/reports');
}

async function apiRunIntegrityScan() {
  return apiFetch('/integrity/run', { method: 'POST' });
}

// ─── Intelligence ───
async function getIntelSources() {
  return apiFetch('/intelligence/sources');
}

async function getIntelFindings(statusFilter) {
  var url = '/intelligence/findings';
  if (statusFilter) url += '?status=' + statusFilter;
  return apiFetch(url);
}

async function apiRunIntelScan() {
  return apiFetch('/intelligence/run', { method: 'POST' });
}

async function approveIntelFinding(id) {
  return apiFetch('/intelligence/approve/' + id, { method: 'POST' });
}

async function rejectIntelFinding(id) {
  return apiFetch('/intelligence/reject/' + id, {
    method: 'POST',
    body: JSON.stringify({ reason: 'Rejected via UI' })
  });
}

// ─── Briefing ───
async function getBriefingHistory() {
  return apiFetch('/briefing/history');
}

async function getLatestBriefing() {
  return apiFetch('/briefing/latest');
}

async function apiRunBriefing() {
  return apiFetch('/briefing/run', { method: 'POST' });
}

async function previewBriefing() {
  return apiFetch('/briefing/preview', { method: 'POST' });
}

// ─── Life Sciences ───
async function getRecentLogs(limit) {
  return apiFetch('/logs/recent?limit=' + (limit || 10));
}

// ─── Travel ───
async function getTrips() {
  return apiFetch('/travel/trips');
}

async function getFlightWatches() {
  return apiFetch('/travel/flights/watch');
}

async function getTravelProfile() {
  return apiFetch('/travel/profile');
}

// ─── Italy 2026 ───
async function getItaly2026Data() {
  return apiFetch('/connectors/italy2026/data');
}

// ─── Slab ───
async function postSlabRequest(request) {
  return apiFetch('/agents/slab-inventory-tracker-agent', {
    method: 'POST',
    body: JSON.stringify({ request: request })
  });
}

// ─── Memory ───
async function getMemoryProposals() {
  return apiFetch('/memory/proposals');
}

async function getMemoryFacts() {
  return apiFetch('/memory/facts');
}

async function getMemoryHistory() {
  return apiFetch('/memory/history');
}

async function approveMemoryProposal(id) {
  return apiFetch('/memory/proposals/' + id + '/approve', { method: 'POST' });
}

async function rejectMemoryProposal(id, reason) {
  return apiFetch('/memory/proposals/' + id + '/reject', {
    method: 'POST',
    body: JSON.stringify({ reason: reason || '' })
  });
}

async function apiRunMemoryConsolidation() {
  return apiFetch('/memory/run', { method: 'POST' });
}
