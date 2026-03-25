// public/js/dashboards/travel.js
// Travel dashboard logic

async function renderTravelDashboard(el) {
  el.innerHTML = '<div class="dash-header"><div class="dash-title">Travel Agent</div><div class="dash-subtitle">Personal Life &mdash; Trips, Flights, Loyalty</div></div>' +
    '<div class="dash-actions"><button class="dash-btn" onclick="dashTravelPlan()">Plan a Trip</button></div>' +
    '<div class="dash-section-label">Active Trip Plans</div>' +
    '<div id="dashTravelTripCards" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:28px">' +
      '<div class="dash-card" id="dashItalyTripCard" onclick="openDashboard(\'italy2026\')" style="cursor:pointer;border-color:#2A6496;border-width:1px;position:relative;overflow:hidden;transition:all 0.25s ease"' +
        ' onmouseover="this.style.borderColor=\'#3a8bc2\';this.style.boxShadow=\'0 0 20px rgba(42,100,150,0.15)\'" onmouseout="this.style.borderColor=\'#2A6496\';this.style.boxShadow=\'none\'">' +
        '<div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,#2A6496,#4a9ed6)"></div>' +
        '<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;padding-top:4px">' +
          '<div style="width:40px;height:40px;border-radius:10px;background:rgba(42,100,150,0.12);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">&#9992;</div>' +
          '<div><div class="dash-card-title" style="color:#4a9ed6;margin-bottom:2px">Italy 2026</div>' +
            '<div style="font-size:10px;color:var(--text-muted);font-family:\'JetBrains Mono\',monospace;letter-spacing:0.05em">FAMILY TRIP</div></div>' +
          '<div id="dashItalyStatusDot" style="margin-left:auto;width:8px;height:8px;border-radius:50%;background:var(--text-muted)" title="Checking..."></div>' +
        '</div>' +
        '<div id="dashItalyTripMeta" style="font-size:12px;color:var(--text-secondary);line-height:1.6">' +
          '<div style="color:var(--text-muted);font-size:11px">Loading trip data...</div>' +
        '</div>' +
        '<div style="display:flex;align-items:center;justify-content:flex-end;margin-top:10px">' +
          '<span style="font-family:\'JetBrains Mono\',monospace;font-size:10px;color:#2A6496;letter-spacing:0.05em">VIEW DETAILS &rarr;</span>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="dash-section-label">Upcoming Trips</div>' +
    '<div id="dashTravelTrips"><div class="dash-loading">Loading...</div></div>' +
    '<div class="dash-section-label">Active Flight Watches</div>' +
    '<div id="dashTravelWatches"><div class="dash-loading">Loading...</div></div>' +
    '<div class="dash-section-label">Travel Profile</div>' +
    '<div id="dashTravelProfile"><div class="dash-loading">Loading...</div></div>' +
    dashChatHtml('travel-agent');

  // Fetch all three in parallel
  Promise.allSettled([
    getTrips(),
    getFlightWatches(),
    getTravelProfile()
  ]).then(function(results) {
    // Trips
    var tripsEl = document.getElementById('dashTravelTrips');
    if (results[0].status === 'fulfilled') {
      var trips = Array.isArray(results[0].value) ? results[0].value : [];
      if (trips.length === 0) {
        tripsEl.innerHTML = '<div class="dash-empty">No upcoming trips.</div>';
      } else {
        var html = '';
        for (var i = 0; i < trips.length; i++) {
          var t = trips[i];
          html += '<div class="dash-card"><div class="dash-card-title">' + escapeHtml(t.destination || t.name || 'Trip') + '</div>' +
            '<div class="dash-card-meta">' + escapeHtml((t.start_date || '') + ' to ' + (t.end_date || '')) + '</div>' +
            '<div class="dash-card-body">' + escapeHtml(t.notes || t.purpose || '') + '</div></div>';
        }
        tripsEl.innerHTML = html;
      }
    } else {
      tripsEl.innerHTML = '<div class="dash-empty">Failed to load trips.</div>';
    }

    // Flight watches
    var watchEl = document.getElementById('dashTravelWatches');
    if (results[1].status === 'fulfilled') {
      var watches = Array.isArray(results[1].value) ? results[1].value : [];
      if (watches.length === 0) {
        watchEl.innerHTML = '<div class="dash-empty">No active flight watches.</div>';
      } else {
        var whtml = '<table class="dash-table"><thead><tr><th>Route</th><th>Max Price</th><th>Class</th><th>Status</th></tr></thead><tbody>';
        for (var w = 0; w < watches.length; w++) {
          var fw = watches[w];
          whtml += '<tr><td>' + escapeHtml((fw.origin || '') + ' → ' + (fw.destination || '')) + '</td>' +
            '<td>' + escapeHtml(fw.max_price ? ('$' + fw.max_price) : 'Any') + '</td>' +
            '<td>' + escapeHtml(fw.cabin_class || 'Any') + '</td>' +
            '<td>' + escapeHtml(fw.status || 'active') + '</td></tr>';
        }
        whtml += '</tbody></table>';
        watchEl.innerHTML = whtml;
      }
    } else {
      watchEl.innerHTML = '<div class="dash-empty">Failed to load watches.</div>';
    }

    // Profile
    var profEl = document.getElementById('dashTravelProfile');
    if (results[2].status === 'fulfilled') {
      var p = results[2].value || {};
      var profHtml = '<div class="dash-card">';
      if (p.home_airports) profHtml += '<div class="dash-card-meta"><strong>Home Airports:</strong> ' + escapeHtml(Array.isArray(p.home_airports) ? p.home_airports.join(', ') : p.home_airports) + '</div>';
      if (p.airline_preference) profHtml += '<div class="dash-card-meta"><strong>Airline:</strong> ' + escapeHtml(p.airline_preference) + '</div>';
      if (p.hotel_programs) profHtml += '<div class="dash-card-meta"><strong>Hotel Programs:</strong> ' + escapeHtml(Array.isArray(p.hotel_programs) ? p.hotel_programs.map(function(h){return h.program || h;}).join(', ') : JSON.stringify(p.hotel_programs)) + '</div>';
      if (p.car_rental) profHtml += '<div class="dash-card-meta"><strong>Car Rental:</strong> ' + escapeHtml(typeof p.car_rental === 'object' ? (p.car_rental.company || JSON.stringify(p.car_rental)) : p.car_rental) + '</div>';
      profHtml += '</div>';
      profEl.innerHTML = profHtml;
    } else {
      profEl.innerHTML = '<div class="dash-empty">Failed to load profile.</div>';
    }
  });

  // Fetch Italy 2026 trip card data
  getItaly2026Data().then(function(data) {
    var dot = document.getElementById('dashItalyStatusDot');
    var meta = document.getElementById('dashItalyTripMeta');
    if (!dot || !meta) return;
    if (data.error || !data.available) {
      dot.style.background = 'var(--text-muted)';
      dot.title = 'Unreachable';
      meta.innerHTML = '<div style="color:var(--text-muted);font-size:11px">App offline &mdash; click to view cached data</div>';
      return;
    }
    dot.style.background = 'var(--color-success)';
    dot.title = 'Connected';
    var trip = data.trip || {};
    var bookings = data.bookings || [];
    var cal = data.calendar || [];
    var packing = data.packing || {};
    var booked = bookings.filter(function(b){return b.status==='Booked'}).length;
    var pct = packing.total > 0 ? Math.round((packing.checked / packing.total) * 100) : 0;
    // Find trip date range from calendar
    var dates = cal.map(function(e){return e.date}).filter(Boolean).sort();
    var dateRange = dates.length > 0 ? dates[0] + ' to ' + dates[dates.length - 1] : 'Dates TBD';
    try {
      if (dates.length > 0) {
        var s = new Date(dates[0] + 'T12:00:00');
        var e = new Date(dates[dates.length-1] + 'T12:00:00');
        dateRange = s.toLocaleDateString('en-US',{month:'short',day:'numeric'}) + ' &ndash; ' + e.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
        var now = new Date();
        var diff = Math.ceil((s - now) / 86400000);
        if (diff > 0) dateRange += ' <span style="color:#4a9ed6;font-weight:600">(' + diff + ' days away)</span>';
        else if (diff === 0) dateRange += ' <span style="color:var(--color-success);font-weight:600">(Today!)</span>';
      }
    } catch(ex){}
    meta.innerHTML =
      '<div>' + dateRange + '</div>' +
      '<div style="display:flex;gap:16px;margin-top:6px">' +
        '<span>' + bookings.length + ' bookings <span style="color:var(--color-success)">(' + booked + ' confirmed)</span></span>' +
        '<span>' + cal.length + ' events</span>' +
      '</div>' +
      '<div style="margin-top:8px">' +
        '<div style="display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:11px;color:var(--text-muted)">Packing</span>' +
          '<div style="flex:1;background:var(--border-subtle);border-radius:3px;height:5px;overflow:hidden">' +
            '<div style="background:#2A6496;height:100%;width:' + pct + '%;transition:width 0.5s"></div>' +
          '</div>' +
          '<span style="font-size:11px;color:var(--text-muted)">' + pct + '%</span>' +
        '</div>' +
      '</div>';
  }).catch(function() {
    var dot = document.getElementById('dashItalyStatusDot');
    if (dot) { dot.style.background = 'var(--text-muted)'; dot.title = 'Error'; }
  });
}

function dashTravelPlan() {
  var input = document.getElementById('dashChatInput');
  input.value = '';
  input.focus();
  input.placeholder = 'e.g., Plan a trip to Indianapolis next week, 2 nights...';
}
