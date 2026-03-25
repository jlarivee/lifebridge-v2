async function saveIdea() {
  var input = document.getElementById('newIdeaInput');
  var text = input.value.trim();
  if (!text) return;
  input.value = '';
  try {
    await createIdea(text);
    loadIdeas();
  } catch (e) {
    alert('Error: ' + e.message);
  }
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && document.activeElement === document.getElementById('newIdeaInput')) {
    saveIdea();
  }
});

async function loadIdeas() {
  var list = document.getElementById('ideasList');
  if (!list) return;
  var showArchived = document.getElementById('showArchivedToggle')?.checked;
  try {
    var ideas = await getIdeas();
    var filtered = showArchived ? ideas : ideas.filter(function(i) { return i.status !== 'archived'; });

    if (!filtered.length) {
      list.innerHTML = '<div style="text-align:center;color:var(--text-tertiary);font-family:var(--font-mono);font-size:12px;padding:40px 0;">No ideas yet. Capture one above.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
      var idea = filtered[i];
      var isArchived = idea.status === 'archived';
      var date = new Date(idea.created_at).toLocaleDateString();
      var lastSent = idea.last_sent_at ? new Date(idea.last_sent_at).toLocaleDateString() : 'never';

      html += '<div style="background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:8px;padding:14px 16px;margin-bottom:8px;opacity:' + (isArchived ? '0.4' : '1') + ';">';

      // Editable text
      html += '<div contenteditable="' + (isArchived ? 'false' : 'true') + '" ';
      html += 'onblur="updateIdea(\'' + idea.id + '\', this.textContent)" ';
      html += 'style="font-size:14px;color:var(--text-primary);line-height:1.5;outline:none;min-height:20px;cursor:' + (isArchived ? 'default' : 'text') + ';">';
      html += escapeHtml(idea.text);
      html += '</div>';

      // Meta row
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">';
      html += '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-tertiary);">';
      html += date;
      if (idea.send_count > 0) html += ' &middot; sent ' + idea.send_count + 'x &middot; last: ' + lastSent;
      if (isArchived) html += ' &middot; <span style="color:#ef4444;">archived</span>';
      html += '</div>';

      if (!isArchived) {
        html += '<div style="display:flex;gap:6px;">';
        html += '<button onclick="sendIdea(\'' + idea.id + '\', this)" style="font-family:var(--font-mono);font-size:10px;padding:4px 10px;border-radius:4px;border:1px solid var(--amber);background:transparent;color:var(--amber);cursor:pointer;">Send to LifeBridge</button>';
        html += '<button onclick="archiveIdea(\'' + idea.id + '\')" style="font-family:var(--font-mono);font-size:10px;padding:4px 8px;border-radius:4px;border:1px solid var(--border-subtle);background:transparent;color:var(--text-tertiary);cursor:pointer;">&times;</button>';
        html += '</div>';
      }

      html += '</div>';

      // Show last response if exists
      if (idea.agent_responses && idea.agent_responses.length > 0) {
        var lastResp = idea.agent_responses[idea.agent_responses.length - 1];
        html += '<details style="margin-top:10px;"><summary style="font-family:var(--font-mono);font-size:10px;color:var(--text-tertiary);cursor:pointer;">Last response (confidence: ' + (lastResp.confidence || '?') + ')</summary>';
        html += '<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary);white-space:pre-wrap;line-height:1.5;margin-top:8px;padding:10px;background:var(--bg-surface);border-radius:6px;max-height:300px;overflow-y:auto;">' + escapeHtml(lastResp.response || '') + '</div>';
        html += '</details>';
      }

      html += '</div>';
    }

    list.innerHTML = html;
  } catch (e) {
    list.innerHTML = '<div style="color:#ef4444;font-family:var(--font-mono);font-size:11px;">' + escapeHtml(e.message) + '</div>';
  }
}

async function updateIdea(id, newText) {
  if (!newText?.trim()) return;
  try {
    await updateIdea(id, newText.trim());
  } catch {}
}

async function archiveIdea(id) {
  try {
    await deleteIdea(id);
    loadIdeas();
  } catch {}
}

async function sendIdea(id, btn) {
  if (btn) { btn.textContent = 'Routing...'; btn.disabled = true; }
  try {
    var result = await sendIdea(id);
    loadIdeas();
    // Navigate to routing view to show the result
    if (result.routing_result) {
      currentRouteResult = result.routing_result;
      currentRouteInput = result.idea.text;
      navigateTo('routing');
      renderRoutingResult(result.routing_result, result.idea.text);
    }
  } catch (e) {
    if (btn) { btn.textContent = 'Failed'; btn.style.color = '#ef4444'; }
  }
}
