async function renderSlabInventoryDashboard(el) {
  el.innerHTML = `
    <div class="dash-header">
      <div class="dash-title">Three Rivers Slab Co. Inventory</div>
      <div class="dash-subtitle">Live-edge slab tracking and analytics</div>
    </div>
    
    <div class="dash-tabs">
      <div class="dash-tab active" data-tab="overview">Overview</div>
      <div class="dash-tab" data-tab="charts">Charts</div>
      <div class="dash-tab" data-tab="aging">Aging Alerts</div>
    </div>

    <div class="dash-tab-content active" data-content="overview">
      <div id="slab-stats-container">
        <div class="dash-loading">Loading inventory statistics...</div>
      </div>
    </div>

    <div class="dash-tab-content" data-content="charts">
      <div id="slab-charts-container">
        <div class="dash-loading">Loading inventory charts...</div>
      </div>
    </div>

    <div class="dash-tab-content" data-content="aging">
      <div id="slab-aging-container">
        <div class="dash-loading">Loading aging analysis...</div>
      </div>
    </div>
  `;

  // Initialize tab switching
  initSlabTabs();
  
  // Load initial data
  loadSlabStats();
}

function initSlabTabs() {
  const tabs = document.querySelectorAll('.dash-tab');
  const contents = document.querySelectorAll('.dash-tab-content');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      
      // Update active states
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      document.querySelector(`[data-content="${targetTab}"]`).classList.add('active');
      
      // Load data for the selected tab
      if (targetTab === 'overview') loadSlabStats();
      else if (targetTab === 'charts') loadSlabCharts();
      else if (targetTab === 'aging') loadSlabAging();
    });
  });
}

async function loadSlabStats() {
  const container = document.getElementById('slab-stats-container');
  
  try {
    const response = await fetch('/agents/slab-inventory-tracker-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: 'DASHBOARD_STATS' })
    });
    
    const result = await response.json();
    const data = result.output;
    
    container.innerHTML = `
      <div class="slab-stats-grid">
        <div class="dash-card">
          <div class="dash-card-body">
            <div class="slab-stat-number">${data.stats.total_slabs}</div>
            <div class="slab-stat-label">Total Slabs</div>
          </div>
        </div>
        
        <div class="dash-card">
          <div class="dash-card-body">
            <div class="slab-stat-number">${data.stats.available_slabs}</div>
            <div class="slab-stat-label">Available for Sale</div>
          </div>
        </div>
        
        <div class="dash-card">
          <div class="dash-card-body">
            <div class="slab-stat-number">$${data.stats.total_value.toLocaleString()}</div>
            <div class="slab-stat-label">Total Inventory Value</div>
          </div>
        </div>
        
        <div class="dash-card">
          <div class="dash-card-body">
            <div class="slab-stat-number">${Math.round(data.stats.avg_days_inventory)}</div>
            <div class="slab-stat-label">Avg Days in Inventory</div>
          </div>
        </div>
        
        <div class="dash-card ${data.stats.aging_slabs > 0 ? 'slab-alert' : ''}">
          <div class="dash-card-body">
            <div class="slab-stat-number">${data.stats.aging_slabs}</div>
            <div class="slab-stat-label">Aging Slabs (60+ days)</div>
          </div>
        </div>
      </div>

      <div class="slab-breakdown-section">
        <h3 class="dash-section-label">Inventory by Species</h3>
        <div class="slab-species-grid">
          ${Object.entries(data.species_breakdown).map(([species, count]) => `
            <div class="slab-species-item">
              <span class="slab-species-name">${species}</span>
              <span class="slab-species-count">${count} slabs</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="slab-breakdown-section">
        <h3 class="dash-section-label">Status Breakdown</h3>
        <div class="slab-status-grid">
          ${Object.entries(data.status_breakdown).map(([status, count]) => `
            <div class="slab-status-item">
              <span class="slab-status-name">${status}</span>
              <span class="slab-status-count">${count} slabs</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    
  } catch (error) {
    container.innerHTML = `<div class="dash-empty">Error loading stats: ${error.message}</div>`;
  }
}

async function loadSlabCharts() {
  const container = document.getElementById('slab-charts-container');
  
  try {
    const response = await fetch('/agents/slab-inventory-tracker-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: 'DASHBOARD_CHARTS' })
    });
    
    const result = await response.json();
    const data = result.output;
    
    container.innerHTML = `
      <div class="slab-charts-grid">
        <div class="dash-card">
          <div class="dash-card-title">Species Distribution</div>
          <div class="dash-card-body">
            <div class="slab-chart" id="species-chart">
              ${Object.entries(data.species_chart).map(([species, info]) => `
                <div class="slab-chart-bar">
                  <div class="slab-chart-label">${species}</div>
                  <div class="slab-chart-value">
                    <div class="slab-chart-fill" style="width: ${(info.count / Math.max(...Object.values(data.species_chart).map(v => v.count))) * 100}%"></div>
                    <span>${info.count} slabs</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="dash-card">
          <div class="dash-card-title">Inventory Age Distribution</div>
          <div class="dash-card-body">
            <div class="slab-chart" id="aging-chart">
              ${Object.entries(data.aging_chart).map(([bucket, count]) => `
                <div class="slab-chart-bar">
                  <div class="slab-chart-label">${bucket}</div>
                  <div class="slab-chart-value">
                    <div class="slab-chart-fill" style="width: ${(count / Math.max(...Object.values(data.aging_chart))) * 100}%"></div>
                    <span>${count} slabs</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>

        <div class="dash-card">
          <div class="dash-card-title">Value by Species</div>
          <div class="dash-card-body">
            <div class="slab-chart" id="value-chart">
              ${Object.entries(data.species_chart).map(([species, info]) => `
                <div class="slab-chart-bar">
                  <div class="slab-chart-label">${species}</div>
                  <div class="slab-chart-value">
                    <div class="slab-chart-fill" style="width: ${(info.value / Math.max(...Object.values(data.species_chart).map(v => v.value))) * 100}%"></div>
                    <span>$${info.value.toLocaleString()}</span>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
    
  } catch (error) {
    container.innerHTML = `<div class="dash-empty">Error loading charts: ${error.message}</div>`;
  }
}

async function loadSlabAging() {
  const container = document.getElementById('slab-aging-container');
  
  try {
    const response = await fetch('/agents/slab-inventory-tracker-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request: 'DASHBOARD_STATS' })
    });
    
    const result = await response.json();
    const agingSlabs = result.output.aging_slabs;
    
    if (agingSlabs.length === 0) {
      container.innerHTML = `
        <div class="dash-card">
          <div class="dash-card-body">
            <div class="slab-aging-good">✓ No slabs aging beyond 60 days</div>
            <p>All available inventory is moving at a healthy pace.</p>
          </div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="slab-aging-alert">
        <h3 class="dash-section-label">⚠️ ${agingSlabs.length} Slabs Need Attention (60+ days)</h3>
        
        <div class="slab-aging-list">
          ${agingSlabs.map(slab => `
            <div class="dash-card slab-aging-item">
              <div class="dash-card-body">
                <div class="slab-aging-header">
                  <span class="slab-aging-species">${slab.species}</span>
                  <span class="slab-aging-days">${slab.days_in_inventory} days</span>
                </div>
                <div class="slab-aging-details">
                  <div>${slab.length_inches}"L × ${slab.width_inches}"W × ${slab.thickness_inches}"T</div>
                  <div>Location: ${slab.yard_location || 'Not specified'}</div>
                  <div>Current price: $${slab.asking_price?.toLocaleString() || 'TBD'}</div>
                </div>
                <div class="slab-aging-suggestion">
                  Suggestion: ${slab.days_in_inventory > 120 ? 'Consider 15-20% price reduction' : 
                               slab.days_in_inventory > 90 ? 'Post on additional marketplaces' : 
                               'Monitor for another 30 days'}
                </div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    
  } catch (error) {
    container.innerHTML = `<div class="dash-empty">Error loading aging analysis: ${error.message}</div>`;
  }
}