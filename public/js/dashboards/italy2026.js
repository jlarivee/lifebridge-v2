// public/js/dashboards/italy2026.js
// Italy 2026 trip dashboard logic

async function renderItaly2026Dashboard(el) {
  var italy2026Url = '';
  el.innerHTML = '<div class="dash-header">' +
    '<div style="display:flex;justify-content:space-between;align-items:flex-start">' +
      '<div><div class="dash-title" style="color:#2A6496">Italy 2026</div><div class="dash-subtitle">Personal Life &mdash; Family Trip Planning</div></div>' +
      '<button class="dash-btn" style="background:rgba(42,100,150,0.12);color:#2A6496;border-color:#2A6496" id="dashItalyOpenBtn" onclick="openItaly2026App()">Open App &rarr;</button>' +
    '</div>' +
  '</div>' +
  '<div class="dash-tabs">' +
    '<button class="dash-tab active" onclick="dashItalyTab(\'itinerary\',this)">Itinerary</button>' +
    '<button class="dash-tab" onclick="dashItalyTab(\'bookings\',this)">Bookings</button>' +
    '<button class="dash-tab" onclick="dashItalyTab(\'packing\',this)">Packing</button>' +
    '<button class="dash-tab" onclick="dashItalyTab(\'ideas\',this)">Ideas</button>' +
  '</div>' +
  '<div class="dash-tab-content active" id="dashItalyItinerary"><div class="dash-loading">Loading...</div></div>' +
  '<div class="dash-tab-content" id="dashItalyBookings"></div>' +
  '<div class="dash-tab-content" id="dashItalyPacking"></div>' +
  '<div class="dash-tab-content" id="dashItalyIdeas"></div>' +
  dashChatHtml('travel-agent');

  try {
    var data = await getItaly2026Data();
    window._italyData = data;
    if (data.error || !data.available) {
      el.querySelector('#dashItalyItinerary').innerHTML = '<div class="dash-empty">Italy 2026 app is not reachable. Data unavailable.</div>';
      return;
    }
    renderItalyItinerary(data);
    renderItalyBookings(data);
    renderItalyPacking(data);
    renderItalyIdeas(data);
  } catch (e) {
    el.querySelector('#dashItalyItinerary').innerHTML = '<div class="dash-empty">Failed to load: ' + escapeHtml(e.message) + '</div>';
  }
}

function openItaly2026App() {
  var url = window._italyData && window._italyData.trip ? null : null;
  // The URL is server-side only — open the known Replit URL
  window.open('https://italy-2026.replit.app', '_blank');
}

function dashItalyTab(tab, btn) {
  var tabs = document.querySelectorAll('.dash-tab');
  var contents = document.querySelectorAll('.dash-tab-content');
  tabs.forEach(function(t) { t.classList.remove('active'); });
  contents.forEach(function(c) { c.classList.remove('active'); });
  btn.classList.add('active');
  var map = { itinerary: 'dashItalyItinerary', bookings: 'dashItalyBookings', packing: 'dashItalyPacking', ideas: 'dashItalyIdeas' };
  var target = document.getElementById(map[tab]);
  if (target) target.classList.add('active');
}

function renderItalyItinerary(data) {
  var container = document.getElementById('dashItalyItinerary');
  var events = data.calendar || [];
  if (events.length === 0) { container.innerHTML = '<div class="dash-empty">No calendar events.</div>'; return; }

  // Group by date
  var groups = {};
  events.forEach(function(e) {
    var d = e.date || 'TBD';
    if (!groups[d]) groups[d] = [];
    groups[d].push(e);
  });

  var html = '';
  var dates = Object.keys(groups).sort();
  for (var i = 0; i < dates.length; i++) {
    var date = dates[i];
    var dayEvents = groups[date];
    var dayLabel = date;
    try {
      var dt = new Date(date + 'T12:00:00');
      dayLabel = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    } catch {}
    html += '<div class="dash-section-label">' + escapeHtml(dayLabel) + '</div>';
    for (var j = 0; j < dayEvents.length; j++) {
      var ev = dayEvents[j];
      html += '<div class="dash-card"><div class="dash-card-title">' +
        (ev.time ? escapeHtml(ev.time) + ' — ' : '') + escapeHtml(ev.title) +
        '</div><div class="dash-card-meta">' +
        (ev.location ? escapeHtml(ev.location) : '') +
        (ev.category ? ' &bull; ' + escapeHtml(ev.category) : '') +
        '</div>' +
        (ev.notes ? '<div class="dash-card-body">' + escapeHtml(ev.notes) + '</div>' : '') +
        '</div>';
    }
  }
  container.innerHTML = html;
}

function renderItalyBookings(data) {
  var container = document.getElementById('dashItalyBookings');
  var sections = [
    { label: 'Flights & Travel', items: data.flights || [] },
    { label: 'Hotels & Accommodation', items: data.hotels || [] },
    { label: 'Restaurants & Dining', items: data.restaurants || [] },
    { label: 'Activities & Experiences', items: data.activities || [] }
  ];

  var html = '';
  for (var s = 0; s < sections.length; s++) {
    var sec = sections[s];
    html += '<div class="dash-section-label">' + sec.label + ' (' + sec.items.length + ')</div>';
    if (sec.items.length === 0) {
      html += '<div class="dash-empty">None booked yet.</div>';
      continue;
    }
    for (var i = 0; i < sec.items.length; i++) {
      var b = sec.items[i];
      var statusColor = b.status === 'Booked' ? 'var(--color-success)' : (b.status === 'To Book' ? 'var(--accent-amber)' : 'var(--text-tertiary)');
      html += '<div class="dash-card"><div class="dash-card-title">' + escapeHtml(b.name) + '</div>' +
        '<div class="dash-card-meta">' +
          (b.date_start ? escapeHtml(b.date_start) + (b.date_end && b.date_end !== b.date_start ? ' to ' + escapeHtml(b.date_end) : '') + ' &bull; ' : '') +
          '<span style="color:' + statusColor + '">' + escapeHtml(b.status) + '</span>' +
          (b.confirmation ? ' &bull; #' + escapeHtml(b.confirmation) : '') +
        '</div>' +
        (b.notes ? '<div class="dash-card-body">' + escapeHtml(b.notes) + '</div>' : '') +
        '</div>';
    }
  }

  // Also show all bookings that didn't match filters
  var allBookings = data.bookings || [];
  var filtered = [].concat(data.flights || [], data.hotels || [], data.restaurants || [], data.activities || []);
  var filteredIds = filtered.map(function(b) { return b.id; });
  var other = allBookings.filter(function(b) { return filteredIds.indexOf(b.id) === -1; });
  if (other.length > 0) {
    html += '<div class="dash-section-label">Other (' + other.length + ')</div>';
    for (var o = 0; o < other.length; o++) {
      var ob = other[o];
      html += '<div class="dash-card"><div class="dash-card-title">' + escapeHtml(ob.name) + '</div>' +
        '<div class="dash-card-meta">' + escapeHtml(ob.category || '') + ' &bull; ' + escapeHtml(ob.status || '') + '</div>' +
        (ob.notes ? '<div class="dash-card-body">' + escapeHtml(ob.notes) + '</div>' : '') +
        '</div>';
    }
  }

  container.innerHTML = html;
}

function renderItalyPacking(data) {
  var container = document.getElementById('dashItalyPacking');
  var packing = data.packing || {};
  var total = packing.total || 0;
  var checked = packing.checked || 0;
  var pct = total > 0 ? Math.round((checked / total) * 100) : 0;
  var unchecked = packing.unchecked_items || [];

  var html = '<div class="dash-card" style="margin-bottom:20px">' +
    '<div class="dash-card-title">Packing Progress</div>' +
    '<div style="background:var(--border-subtle);border-radius:4px;height:8px;margin:10px 0;overflow:hidden">' +
      '<div style="background:#2A6496;height:100%;width:' + pct + '%;transition:width 0.5s"></div>' +
    '</div>' +
    '<div class="dash-card-meta">' + checked + ' / ' + total + ' items checked (' + pct + '%)</div>' +
  '</div>';

  if (unchecked.length > 0) {
    html += '<div class="dash-section-label">Unchecked Items (' + unchecked.length + ')</div>';
    // Group by category
    var cats = {};
    unchecked.forEach(function(item) {
      var c = item.category || 'Other';
      if (!cats[c]) cats[c] = [];
      cats[c].push(item);
    });
    var catNames = Object.keys(cats).sort();
    for (var i = 0; i < catNames.length; i++) {
      html += '<div class="dash-card"><div class="dash-card-title">' + escapeHtml(catNames[i]) + '</div>';
      var items = cats[catNames[i]];
      for (var j = 0; j < items.length; j++) {
        html += '<div class="dash-card-meta" style="padding:2px 0">&#9744; ' + escapeHtml(items[j].item) +
          (items[j].owner && items[j].owner !== 'Shared' ? ' <span style="color:var(--text-muted)">(' + escapeHtml(items[j].owner) + ')</span>' : '') + '</div>';
      }
      html += '</div>';
    }
  } else {
    html += '<div class="dash-empty">All items checked!</div>';
  }

  container.innerHTML = html;
}

function renderItalyIdeas(data) {
  var container = document.getElementById('dashItalyIdeas');
  var ideas = data.ideas || [];
  if (ideas.length === 0) { container.innerHTML = '<div class="dash-empty">No ideas yet.</div>'; return; }

  var html = '';
  for (var i = 0; i < ideas.length; i++) {
    var idea = ideas[i];
    html += '<div class="dash-card"><div style="display:flex;justify-content:space-between;align-items:flex-start">' +
      '<div><div class="dash-card-title">' + escapeHtml(idea.title) + '</div>' +
        '<div class="dash-card-meta">' + escapeHtml(idea.category || '') + '</div>' +
        (idea.description ? '<div class="dash-card-body">' + escapeHtml(idea.description) + '</div>' : '') +
      '</div>' +
      '<div style="text-align:center;min-width:50px">' +
        '<div style="font-family:JetBrains Mono;font-size:18px;font-weight:700;color:#2A6496">' + (idea.vote_count || 0) + '</div>' +
        '<div style="font-family:JetBrains Mono;font-size:8px;color:var(--text-muted);text-transform:uppercase">votes</div>' +
      '</div>' +
    '</div></div>';
  }
  container.innerHTML = html;
}
