// public/js/dashboards/three-rivers-pricing.js
// Three Rivers Pricing dashboard — slab pricing & FB Marketplace listing generator

var pricingRunning = false;

var SLAB_SPECIES = [
  'Walnut', 'Cherry', 'Maple', 'Oak', 'Ash', 'Elm', 'Sycamore',
  'Butternut', 'Poplar', 'Pine', 'Cedar', 'Other'
];

var FIGURE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'low', label: 'Low (+10%)' },
  { value: 'high', label: 'High (+25%)' },
  { value: 'exceptional', label: 'Exceptional (+40%)' }
];

async function renderPricingDashboard(el) {
  el.innerHTML =
    '<div class="dash-header">' +
      '<div class="dash-title">Three Rivers Pricing</div>' +
      '<div class="dash-subtitle">Market comps &amp; Facebook Marketplace listing generator</div>' +
    '</div>' +
    '<div id="pricingBody">' + pricingFormHtml() + '</div>';
}

function pricingFormHtml() {
  var speciesOptions = SLAB_SPECIES.map(function(s) {
    return '<option value="' + s + '">' + s + '</option>';
  }).join('');

  var figureOptions = FIGURE_OPTIONS.map(function(f) {
    return '<option value="' + f.value + '">' + f.label + '</option>';
  }).join('');

  return '<div class="pricing-form-wrap">' +
    '<div class="pricing-form-card">' +
      '<div class="pricing-section-label">Slab Details</div>' +
      '<div class="pricing-row">' +
        '<div class="pricing-field">' +
          '<label class="pricing-label">Species</label>' +
          '<select class="pricing-select" id="pricingSpecies">' + speciesOptions + '</select>' +
        '</div>' +
        '<div class="pricing-field">' +
          '<label class="pricing-label">Figure</label>' +
          '<select class="pricing-select" id="pricingFigure">' + figureOptions + '</select>' +
        '</div>' +
      '</div>' +
      '<div class="pricing-row">' +
        '<div class="pricing-field">' +
          '<label class="pricing-label">Length (inches)</label>' +
          '<input class="pricing-input" id="pricingLength" type="number" placeholder="e.g. 72" min="1">' +
        '</div>' +
        '<div class="pricing-field">' +
          '<label class="pricing-label">Width (inches)</label>' +
          '<input class="pricing-input" id="pricingWidth" type="number" placeholder="e.g. 24" min="1">' +
        '</div>' +
        '<div class="pricing-field">' +
          '<label class="pricing-label">Thickness (inches)</label>' +
          '<input class="pricing-input" id="pricingThickness" type="number" placeholder="e.g. 2.5" min="0.5" step="0.25">' +
        '</div>' +
      '</div>' +
      '<div class="pricing-row">' +
        '<div class="pricing-field pricing-field-full">' +
          '<label class="pricing-label">Notes (optional)</label>' +
          '<input class="pricing-input" id="pricingNotes" type="text" placeholder="e.g. live edge both sides, large void filled with epoxy">' +
        '</div>' +
      '</div>' +
      '<button class="pricing-btn" id="pricingRunBtn" onclick="pricingRun()">Get Pricing &amp; Listing</button>' +
    '</div>' +
    '<div id="pricingResult"></div>' +
  '</div>';
}

async function pricingRun() {
  if (pricingRunning) return;

  var species   = document.getElementById('pricingSpecies').value;
  var figure    = document.getElementById('pricingFigure').value;
  var length    = parseFloat(document.getElementById('pricingLength').value);
  var width     = parseFloat(document.getElementById('pricingWidth').value);
  var thickness = parseFloat(document.getElementById('pricingThickness').value);
  var notes     = document.getElementById('pricingNotes').value.trim();

  if (!length || !width || !thickness) {
    document.getElementById('pricingResult').innerHTML =
      '<div class="pricing-error">Please enter length, width, and thickness.</div>';
    return;
  }

  pricingRunning = true;
  var btn = document.getElementById('pricingRunBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Researching comps…'; }

  document.getElementById('pricingResult').innerHTML =
    '<div class="pricing-loading">' +
      '<div class="pricing-spinner"></div>' +
      '<div>Searching market comps and generating listing…<br><small>This takes 15–30 seconds</small></div>' +
    '</div>';

  try {
    var payload = {
      species: species,
      length_inches: length,
      width_inches: width,
      thickness_inches: thickness,
      figure: figure,
      notes: notes || null
    };

    var res = await fetch('/agents/three-rivers-pricing-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: payload })
    });
    var data = await res.json();

    document.getElementById('pricingResult').innerHTML = pricingResultHtml(data);
  } catch (e) {
    document.getElementById('pricingResult').innerHTML =
      '<div class="pricing-error">Request failed: ' + escapeHtml(e.message) + '</div>';
  } finally {
    pricingRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Get Pricing & Listing'; }
  }
}

function pricingResultHtml(data) {
  var html = '<div class="pricing-result-card">';

  // Price summary
  if (data.price_range || data.recommended_price) {
    html += '<div class="pricing-section-label">Pricing</div>';
    html += '<div class="pricing-price-row">';
    if (data.recommended_price) {
      html += '<div class="pricing-price-main">$' + data.recommended_price + '<span class="pricing-price-label">recommended</span></div>';
    }
    if (data.price_range) {
      html += '<div class="pricing-price-range">Range: $' + escapeHtml(String(data.price_range)) + '</div>';
    }
    if (data.board_feet) {
      html += '<div class="pricing-price-range">' + data.board_feet + ' board feet</div>';
    }
    html += '</div>';
  }

  // Comps table
  if (data.comps && data.comps.length > 0) {
    html += '<div class="pricing-section-label" style="margin-top:16px">Market Comps</div>';
    html += '<table class="pricing-comps-table">';
    html += '<thead><tr><th>Description</th><th>Price</th><th>$/BF</th></tr></thead><tbody>';
    data.comps.forEach(function(c) {
      html += '<tr>' +
        '<td>' + escapeHtml(c.description || c.title || '') + '</td>' +
        '<td>$' + escapeHtml(String(c.price || '')) + '</td>' +
        '<td>' + escapeHtml(String(c.price_per_bf || c.per_bf || '—')) + '</td>' +
      '</tr>';
    });
    html += '</tbody></table>';
  }

  // FB Listing
  if (data.listing) {
    html += '<div class="pricing-section-label" style="margin-top:16px">Facebook Marketplace Listing</div>';
    html += '<div class="pricing-listing-wrap">' +
      '<pre class="pricing-listing">' + escapeHtml(data.listing) + '</pre>' +
      '<button class="pricing-copy-btn" onclick="pricingCopyListing(this)">Copy</button>' +
    '</div>';
  }

  // Notes
  if (data.pricing_notes) {
    html += '<div class="pricing-notes">' + escapeHtml(data.pricing_notes) + '</div>';
  }

  // Fallback: raw output
  if (!data.price_range && !data.recommended_price && !data.listing) {
    html += '<div class="pricing-section-label">Output</div>';
    html += '<pre class="pricing-raw">' + escapeHtml(data.output || 'No output') + '</pre>';
  }

  html += '</div>';
  return html;
}

function pricingCopyListing(btn) {
  var pre = btn.parentElement.querySelector('pre');
  if (!pre) return;
  navigator.clipboard.writeText(pre.textContent).then(function() {
    btn.textContent = 'Copied!';
    setTimeout(function() { btn.textContent = 'Copy'; }, 2000);
  });
}

window.renderPricingDashboard = renderPricingDashboard;
window.pricingRun = pricingRun;
window.pricingCopyListing = pricingCopyListing;
