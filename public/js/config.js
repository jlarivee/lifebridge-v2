// public/js/config.js
// LifeBridge frontend configuration
// All agent routing maps and domain data lives here.
// To add a new agent: add entries to AGENT_ENDPOINTS,
// AGENT_LABELS, and DASHBOARD_AGENTS. Nothing else needs changing.

var AGENT_ENDPOINTS = {
  'life-sciences-account-agent': '/agents/life-sciences-account-agent',
  'agent-builder-agent': '/agents/builder',
  'morning-briefing-agent': '/agents/morning-briefing-agent',
  'travel-agent': '/agents/travel-agent',
  'slab-inventory-tracker-agent': '/agents/slab-inventory-tracker-agent',
  'memory-consolidation-agent': '/agents/memory-consolidation-agent',
  'registry-integrity-agent': '/agents/registry-integrity-agent',
  'intelligence-update-agent': '/agents/intelligence-update-agent',
  'connectors': '/agents/connectors',
  'three-rivers-social-agent': '/agents/three-rivers-social-agent',
  'investment-research-agent': '/agents/investment-research-agent',
  'test-agent': '/test/run',
  'three-rivers-pricing-agent': '/agents/three-rivers-pricing-agent',
  'prompt-engineering-agent': '/api/prompt-engineering/session/start'
};

var AGENT_LABELS = {
  'life-sciences-account-agent': 'Life Sciences Account Agent',
  'agent-builder-agent': 'Agent Builder Agent',
  'morning-briefing-agent': 'Morning Briefing',
  'travel-agent': 'Travel Agent',
  'slab-inventory-tracker-agent': 'Three Rivers Slab',
  'memory-consolidation-agent': 'Memory Consolidation',
  'registry-integrity-agent': 'Registry Integrity Agent',
  'intelligence-update-agent': 'Intelligence Update Agent',
  'connectors': 'Connectors',
  'three-rivers-social-agent': 'Social Media',
  'investment-research-agent': 'Investment Research',
  'three-rivers-pricing-agent': 'Three Rivers Pricing',
  'prompt-engineering-agent': 'Prompt Engineering'
};

var DASHBOARD_AGENTS = {
  'morning-briefing-agent': true,
  'life-sciences-account-agent': true,
  'travel-agent': true,
  'slab-inventory-tracker-agent': true,
  'memory-consolidation-agent': true,
  'italy2026': true,
  'investment-research-agent': true,
  'three-rivers-pricing-agent': true
};

var QUICK_ACTIONS = {
  'life-sciences-account-agent': [
    'Account brief',
    'Meeting prep',
    'Executive briefing',
    'Competitive positioning',
    'Stakeholder dossier',
    'Outreach email'
  ]
};

var DOMAIN_MASTERS = [
  {
    id: 'aws-life-sciences', label: 'Life Sciences', domain: 'Work',
    color: '#FF9900', dimColor: 'rgba(255,153,0,0.12)',
    subs: [
      { name: 'life-sciences-account-agent', label: 'Acct Intel', active: true },
      { name: 'morning-briefing-agent', label: 'Briefing', active: true },
      { name: 'intelligence-update-agent', label: 'Intel', active: true },
      { name: 'sca-deal-architect', label: 'SCA', active: false }
    ]
  },
  {
    id: 'three-rivers-slab', label: 'Three Rivers', domain: 'Personal Business',
    color: '#1D9E75', dimColor: 'rgba(29,158,117,0.12)',
    subs: [
      { name: 'slab-inventory-tracker-agent', label: 'Inventory', active: true },
      { name: 'three-rivers-social-agent', label: 'Social', active: true },
      { name: 'three-rivers-pricing-agent', label: 'Pricing', active: true },
      { name: 'customer-agent', label: 'Customer', active: false }
    ]
  },
  {
    id: 'madsprings', label: 'MadSprings', domain: 'Personal Business',
    color: '#D85A30', dimColor: 'rgba(216,90,48,0.12)',
    subs: [
      { name: 'content-agent', label: 'Content', active: false },
      { name: 'orders-agent', label: 'Orders', active: false }
    ]
  },
  {
    id: 'personal-life', label: 'Personal Life', domain: 'Personal Life',
    color: '#534AB7', dimColor: 'rgba(83,74,183,0.12)',
    subs: [
      { name: 'travel-agent', label: 'Travel', active: true },
      { name: 'investment-research-agent', label: 'Investing', active: true },
      { name: 'memory-consolidation-agent', label: 'Memory', active: true },
      { name: 'italy2026', label: 'Italy 2026', active: true, external: true, url: null },
      { name: 'family-scheduler', label: 'Family', active: false }
    ]
  },
  {
    id: 'system', label: 'System', domain: 'System',
    color: '#888780', dimColor: 'rgba(136,135,128,0.12)',
    subs: [
      { name: 'registry-integrity-agent', label: 'Integrity', active: true },
      { name: 'test-agent', label: 'Testing', active: true },
      { name: 'agent-builder-agent', label: 'Builder', active: true },
      { name: 'prompt-engineering-agent', label: 'Prompts', active: true }
    ]
  }
];
