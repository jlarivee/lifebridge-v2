// public/js/dashboards/prompt-engineering.js
// Prompt Engineering Agent — interactive prompt builder dashboard

var peState = {
  view: 'list',         // 'list' | 'session' | 'detail'
  sessionId: null,
  score: 0,
  scoreDimensions: { purpose: 0, audience: 0, format: 0, constraints: 0, examples: 0 },
  generatedPrompt: null,
  readyToGenerate: false,
  savedPrompts: [],
  currentPrompt: null,
  sending: false
};

// ── Entry point ──────────────────────────────────────────────────────────────

function renderPromptEngineeringDashboard(el) {
  peState = {
    view: 'list', sessionId: null, score: 0,
    scoreDimensions: { purpose: 0, audience: 0, format: 0, constraints: 0, examples: 0 },
    generatedPrompt: null, readyToGenerate: false,
    savedPrompts: [], currentPrompt: null, sending: false
  };
  peRender(el);
  peLoadPrompts();
}

function peGetContainer() {
  return document.getElementById('dashboardContent');
}

function peRender(el) {
  var container = el || peGetContainer();
  if (!container) return;
  if (peState.view === 'list') peRenderList(container);
  else if (peState.view === 'session') peRenderSession(container);
  else if (peState.view === 'detail') peRenderDetail(container);
}

// ── View 1: List ─────────────────────────────────────────────────────────────

function peRenderList(el) {
  el.innerHTML =
    '<div class="dash-header">' +
      '<div class="dash-title">Prompt Engineering</div>' +
      '<div class="dash-subtitle">Build Claude-quality prompts for anything</div>' +
    '</div>' +
    '<div class="pe-list-layout">' +
      '<div class="pe-start-card">' +
        '<div class="pe-start-label">Start New Prompt</div>' +
        '<textarea id="peTopicInput" class="pe-topic-input" placeholder="Describe your rough idea... (e.g. \'I want a prompt to help me write pharma exec emails\')" rows="4"></textarea>' +
        '<button class="pe-btn pe-btn-primary" onclick="peStartSession()">Start Session</button>' +
      '</div>' +
      '<div class="pe-saved-panel">' +
        '<div class="pe-saved-header">' +
          '<div class="pe-saved-label">Saved Prompts</div>' +
          '<span class="pe-saved-count" id="peSavedCount">0</span>' +
        '</div>' +
        '<div id="peSavedList"><div class="pe-empty">Loading...</div></div>' +
      '</div>' +
    '</div>';
}

function peRenderSavedList() {
  var el = document.getElementById('peSavedList');
  var countEl = document.getElementById('peSavedCount');
  if (!el) return;

  var prompts = peState.savedPrompts;
  if (countEl) countEl.textContent = prompts.length;

  if (prompts.length === 0) {
    el.innerHTML = '<div class="pe-empty">No saved prompts yet. Build your first one.</div>';
    return;
  }

  el.innerHTML = prompts.map(function(p) {
    var scoreClass = p.score >= 80 ? 'pe-score-green' : p.score >= 40 ? 'pe-score-yellow' : 'pe-score-red';
    var date = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    return '<div class="pe-saved-card" data-id="' + escapeHtml(p.id) + '">' +
      '<div class="pe-saved-card-top">' +
        '<div class="pe-saved-card-title">' + escapeHtml(p.title) + '</div>' +
        '<span class="pe-score-badge ' + scoreClass + '">' + p.score + '</span>' +
      '</div>' +
      '<div class="pe-saved-card-date">' + date + '</div>' +
      '<div class="pe-saved-card-actions">' +
        '<button class="pe-btn-sm pe-btn-ghost" onclick="peOpenDetail(\'' + escapeHtml(p.id) + '\')">Open</button>' +
        '<button class="pe-btn-sm pe-btn-danger" onclick="peDeletePrompt(\'' + escapeHtml(p.id) + '\')">Delete</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function peLoadPrompts() {
  try {
    var data = await apiFetch('/api/prompt-engineering/prompts');
    peState.savedPrompts = data.prompts || [];
    if (peState.view === 'list') peRenderSavedList();
  } catch (e) {
    var el = document.getElementById('peSavedList');
    if (el) el.innerHTML = '<div class="pe-empty">Could not load saved prompts.</div>';
  }
}

// ── Start session ────────────────────────────────────────────────────────────

async function peStartSession() {
  var input = document.getElementById('peTopicInput');
  if (!input) return;
  var topic = input.value.trim();
  if (!topic) { input.focus(); return; }

  var btn = document.querySelector('.pe-btn-primary');
  if (btn) { btn.textContent = 'Starting...'; btn.disabled = true; }

  try {
    var data = await apiFetch('/api/prompt-engineering/session/start', {
      method: 'POST',
      body: JSON.stringify({ topic: topic })
    });

    peState.sessionId = data.sessionId;
    peState.score = data.score || 0;
    peState.scoreDimensions = data.scoreDimensions || {};
    peState.generatedPrompt = data.generatedPrompt || null;
    peState.readyToGenerate = data.readyToGenerate || false;
    peState.view = 'session';

    var container = peGetContainer();
    peRenderSession(container);
    peAppendMessage('assistant', data.message);
    peScrollChat();

    if (data.readyToGenerate && data.generatedPrompt) {
      peShowGeneratedPrompt(data.generatedPrompt);
    }
  } catch (e) {
    if (btn) { btn.textContent = 'Start Session'; btn.disabled = false; }
    alert('Error: ' + e.message);
  }
}

// ── View 2: Session ──────────────────────────────────────────────────────────

function peRenderSession(el) {
  el.innerHTML =
    '<div class="pe-session-layout">' +
      // Score bar
      '<div class="pe-score-bar">' +
        '<div class="pe-score-main">' +
          '<div class="pe-score-number" id="peScoreNumber">0</div>' +
          '<div class="pe-score-label">Context Richness</div>' +
        '</div>' +
        '<div class="pe-score-track">' +
          '<div class="pe-score-fill" id="peScoreFill" style="width:0%"></div>' +
        '</div>' +
        '<div class="pe-score-dims" id="peScoreDims">' +
          '<span class="pe-dim-pill" data-dim="purpose">Purpose <b>0</b></span>' +
          '<span class="pe-dim-pill" data-dim="audience">Audience <b>0</b></span>' +
          '<span class="pe-dim-pill" data-dim="format">Format <b>0</b></span>' +
          '<span class="pe-dim-pill" data-dim="constraints">Constraints <b>0</b></span>' +
          '<span class="pe-dim-pill" data-dim="examples">Examples <b>0</b></span>' +
        '</div>' +
      '</div>' +
      // Chat area
      '<div class="pe-chat" id="peChat"></div>' +
      // Input area
      '<div class="pe-input-area">' +
        '<textarea id="peChatInput" class="pe-chat-input" placeholder="Your answer..." rows="2" onkeydown="if(event.key===\'Enter\'&&!event.shiftKey){event.preventDefault();peSendMessage();}"></textarea>' +
        '<div class="pe-input-actions">' +
          '<button class="pe-btn pe-btn-primary" id="peSendBtn" onclick="peSendMessage()">Send</button>' +
          '<button class="pe-btn pe-btn-ghost" onclick="peForceGenerate()">Generate Now</button>' +
        '</div>' +
      '</div>' +
      // Generated prompt panel (hidden until ready)
      '<div class="pe-generated-panel" id="peGeneratedPanel" style="display:none">' +
        '<div class="pe-generated-label">Generated Prompt</div>' +
        '<textarea id="peGeneratedText" class="pe-generated-text" rows="8" readonly></textarea>' +
        '<div class="pe-generated-actions">' +
          '<button class="pe-btn pe-btn-primary" onclick="peCopyPrompt()">Copy</button>' +
          '<button class="pe-btn pe-btn-ghost" onclick="peSavePromptModal()">Save</button>' +
          '<button class="pe-btn pe-btn-ghost" onclick="peForceGenerate()">Regenerate</button>' +
          '<button class="pe-btn pe-btn-ghost" onclick="peEditPromptInline()">Edit</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  peUpdateScoreUI(peState.score, peState.scoreDimensions);

  // Set up save modal container
  if (!document.getElementById('peSaveModal')) {
    var modal = document.createElement('div');
    modal.id = 'peSaveModal';
    modal.className = 'pe-modal';
    modal.style.display = 'none';
    modal.innerHTML =
      '<div class="pe-modal-inner">' +
        '<div class="pe-modal-title">Save Prompt</div>' +
        '<input id="peSaveTitle" class="pe-modal-input" placeholder="Title (optional — auto-generated if blank)" />' +
        '<div class="pe-modal-actions">' +
          '<button class="pe-btn pe-btn-primary" onclick="peConfirmSave()">Save</button>' +
          '<button class="pe-btn pe-btn-ghost" onclick="document.getElementById(\'peSaveModal\').style.display=\'none\'">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
  }
}

function peUpdateScoreUI(score, dims) {
  var numEl = document.getElementById('peScoreNumber');
  var fillEl = document.getElementById('peScoreFill');
  if (numEl) numEl.textContent = score;
  if (fillEl) {
    fillEl.style.width = Math.min(score, 100) + '%';
    fillEl.className = 'pe-score-fill ' +
      (score >= 80 ? 'pe-score-fill-green' : score >= 40 ? 'pe-score-fill-yellow' : 'pe-score-fill-red');
  }
  var dimsEl = document.getElementById('peScoreDims');
  if (dimsEl && dims) {
    ['purpose','audience','format','constraints','examples'].forEach(function(d) {
      var pill = dimsEl.querySelector('[data-dim="' + d + '"]');
      if (pill) {
        var val = dims[d] || 0;
        pill.querySelector('b').textContent = val;
        pill.className = 'pe-dim-pill ' + (val >= 15 ? 'pe-dim-green' : val >= 8 ? 'pe-dim-yellow' : 'pe-dim-red');
      }
    });
  }
}

function peAppendMessage(role, text) {
  var chat = document.getElementById('peChat');
  if (!chat) return;
  var div = document.createElement('div');
  div.className = 'pe-message pe-message-' + role;
  div.textContent = text;
  chat.appendChild(div);
}

function peScrollChat() {
  var chat = document.getElementById('peChat');
  if (chat) chat.scrollTop = chat.scrollHeight;
}

async function peSendMessage() {
  if (peState.sending) return;
  var input = document.getElementById('peChatInput');
  if (!input) return;
  var text = input.value.trim();
  if (!text || !peState.sessionId) return;

  peState.sending = true;
  input.value = '';
  peAppendMessage('user', text);
  peScrollChat();

  var btn = document.getElementById('peSendBtn');
  if (btn) { btn.textContent = 'Thinking...'; btn.disabled = true; }

  try {
    var data = await apiFetch('/api/prompt-engineering/session/message', {
      method: 'POST',
      body: JSON.stringify({ sessionId: peState.sessionId, message: text })
    });

    peState.score = data.score || 0;
    peState.scoreDimensions = data.scoreDimensions || {};
    peState.readyToGenerate = data.readyToGenerate || false;
    if (data.generatedPrompt) peState.generatedPrompt = data.generatedPrompt;

    peUpdateScoreUI(peState.score, peState.scoreDimensions);
    peAppendMessage('assistant', data.message);
    peScrollChat();

    if (data.readyToGenerate && data.generatedPrompt) {
      peShowGeneratedPrompt(data.generatedPrompt);
    }
  } catch (e) {
    peAppendMessage('assistant', 'Error: ' + e.message);
  } finally {
    peState.sending = false;
    if (btn) { btn.textContent = 'Send'; btn.disabled = false; }
    if (input) input.focus();
  }
}

async function peForceGenerate() {
  if (!peState.sessionId) return;
  var btn = document.querySelector('[onclick="peForceGenerate()"]');
  if (btn) { btn.textContent = 'Generating...'; btn.disabled = true; }

  try {
    var data = await apiFetch('/api/prompt-engineering/session/generate', {
      method: 'POST',
      body: JSON.stringify({ sessionId: peState.sessionId })
    });

    peState.generatedPrompt = data.generatedPrompt || data.message;
    peState.score = data.score || peState.score;
    peState.scoreDimensions = data.scoreDimensions || peState.scoreDimensions;
    peUpdateScoreUI(peState.score, peState.scoreDimensions);
    peShowGeneratedPrompt(peState.generatedPrompt);
  } catch (e) {
    alert('Generation failed: ' + e.message);
  } finally {
    document.querySelectorAll('[onclick="peForceGenerate()"]').forEach(function(b) {
      b.textContent = 'Generate Now'; b.disabled = false;
    });
  }
}

function peShowGeneratedPrompt(text) {
  var panel = document.getElementById('peGeneratedPanel');
  var textarea = document.getElementById('peGeneratedText');
  if (panel) panel.style.display = 'block';
  if (textarea) { textarea.value = text; textarea.readOnly = true; }
  if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function peCopyPrompt() {
  var textarea = document.getElementById('peGeneratedText');
  if (!textarea) return;
  navigator.clipboard.writeText(textarea.value).then(function() {
    var btn = document.querySelector('[onclick="peCopyPrompt()"]');
    if (btn) { var orig = btn.textContent; btn.textContent = 'Copied!'; setTimeout(function() { btn.textContent = orig; }, 2000); }
  });
}

function peEditPromptInline() {
  var textarea = document.getElementById('peGeneratedText');
  if (!textarea) return;
  textarea.readOnly = !textarea.readOnly;
  var btn = document.querySelector('[onclick="peEditPromptInline()"]');
  if (btn) btn.textContent = textarea.readOnly ? 'Edit' : 'Lock';
  if (!textarea.readOnly) textarea.focus();
}

function peSavePromptModal() {
  var modal = document.getElementById('peSaveModal');
  if (modal) modal.style.display = 'flex';
}

async function peConfirmSave() {
  if (!peState.sessionId) return;
  var titleInput = document.getElementById('peSaveTitle');
  var title = titleInput ? titleInput.value.trim() : '';

  // Use edited prompt text if user changed it
  var textarea = document.getElementById('peGeneratedText');
  if (textarea && !textarea.readOnly) {
    peState.generatedPrompt = textarea.value;
  }

  try {
    await apiFetch('/api/prompt-engineering/prompts/save', {
      method: 'POST',
      body: JSON.stringify({ sessionId: peState.sessionId, title: title || undefined })
    });
    var modal = document.getElementById('peSaveModal');
    if (modal) modal.style.display = 'none';
    var btn = document.querySelector('[onclick="peSavePromptModal()"]');
    if (btn) { var orig = btn.textContent; btn.textContent = 'Saved!'; setTimeout(function() { btn.textContent = orig; }, 2000); }
    peLoadPrompts(); // refresh list in background
  } catch (e) {
    alert('Save failed: ' + e.message);
  }
}

// ── View 3: Detail ───────────────────────────────────────────────────────────

async function peOpenDetail(id) {
  try {
    var data = await apiFetch('/api/prompt-engineering/prompts/' + id);
    peState.currentPrompt = data.prompt;
    peState.view = 'detail';
    peRenderDetail(peGetContainer());
  } catch (e) {
    alert('Could not load prompt: ' + e.message);
  }
}

function peRenderDetail(el) {
  var p = peState.currentPrompt;
  if (!p) { peState.view = 'list'; peRender(el); return; }

  var scoreClass = p.score >= 80 ? 'pe-score-green' : p.score >= 40 ? 'pe-score-yellow' : 'pe-score-red';
  var dims = p.scoreDimensions || {};

  el.innerHTML =
    '<div class="pe-detail-layout">' +
      '<div class="pe-detail-header">' +
        '<button class="pe-back-btn" onclick="peBackToList()">← Back</button>' +
        '<div class="pe-detail-title-wrap">' +
          '<input id="peDetailTitle" class="pe-detail-title" value="' + escapeHtml(p.title) + '" />' +
          '<span class="pe-score-badge ' + scoreClass + '">' + (p.score || 0) + '</span>' +
        '</div>' +
        '<div class="pe-detail-meta">' +
          'Created ' + (p.createdAt ? new Date(p.createdAt).toLocaleDateString() : '') +
          (p.updatedAt && p.updatedAt !== p.createdAt ? ' · Updated ' + new Date(p.updatedAt).toLocaleDateString() : '') +
        '</div>' +
      '</div>' +
      '<div class="pe-dim-pills-row">' +
        ['purpose','audience','format','constraints','examples'].map(function(d) {
          var val = dims[d] || 0;
          var cls = val >= 15 ? 'pe-dim-green' : val >= 8 ? 'pe-dim-yellow' : 'pe-dim-red';
          return '<span class="pe-dim-pill ' + cls + '">' + d.charAt(0).toUpperCase() + d.slice(1) + ' <b>' + val + '</b></span>';
        }).join('') +
      '</div>' +
      '<div class="pe-detail-prompt-label">Prompt</div>' +
      '<textarea id="peDetailPrompt" class="pe-generated-text" rows="12">' + escapeHtml(p.finalPrompt || '') + '</textarea>' +
      '<div class="pe-detail-actions">' +
        '<button class="pe-btn pe-btn-primary" onclick="peDetailSaveChanges()">Save Changes</button>' +
        '<button class="pe-btn pe-btn-ghost" onclick="peCopyDetailPrompt()">Copy</button>' +
        '<button class="pe-btn pe-btn-danger" onclick="peDetailDelete()">Delete</button>' +
      '</div>' +
    '</div>';
}

async function peDetailSaveChanges() {
  var p = peState.currentPrompt;
  if (!p) return;
  var title = document.getElementById('peDetailTitle')?.value.trim() || p.title;
  var finalPrompt = document.getElementById('peDetailPrompt')?.value || p.finalPrompt;

  try {
    var data = await apiFetch('/api/prompt-engineering/prompts/' + p.id, {
      method: 'PATCH',
      body: JSON.stringify({ title: title, finalPrompt: finalPrompt })
    });
    peState.currentPrompt = data.prompt;
    var btn = document.querySelector('[onclick="peDetailSaveChanges()"]');
    if (btn) { var orig = btn.textContent; btn.textContent = 'Saved!'; setTimeout(function() { btn.textContent = orig; }, 2000); }
  } catch (e) {
    alert('Save failed: ' + e.message);
  }
}

function peCopyDetailPrompt() {
  var textarea = document.getElementById('peDetailPrompt');
  if (!textarea) return;
  navigator.clipboard.writeText(textarea.value).then(function() {
    var btn = document.querySelector('[onclick="peCopyDetailPrompt()"]');
    if (btn) { var orig = btn.textContent; btn.textContent = 'Copied!'; setTimeout(function() { btn.textContent = orig; }, 2000); }
  });
}

async function peDeletePrompt(id) {
  if (!confirm('Delete this prompt?')) return;
  try {
    await apiFetch('/api/prompt-engineering/prompts/' + id, { method: 'DELETE' });
    peState.savedPrompts = peState.savedPrompts.filter(function(p) { return p.id !== id; });
    peRenderSavedList();
  } catch (e) {
    alert('Delete failed: ' + e.message);
  }
}

async function peDetailDelete() {
  var p = peState.currentPrompt;
  if (!p) return;
  if (!confirm('Delete this prompt?')) return;
  try {
    await apiFetch('/api/prompt-engineering/prompts/' + p.id, { method: 'DELETE' });
    peBackToList();
  } catch (e) {
    alert('Delete failed: ' + e.message);
  }
}

function peBackToList() {
  peState.view = 'list';
  peState.currentPrompt = null;
  peRender(peGetContainer());
  peLoadPrompts();
}

window.renderPromptEngineeringDashboard = renderPromptEngineeringDashboard;
