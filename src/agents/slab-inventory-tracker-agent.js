import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as db from "../db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(
  join(__dirname, "../skills/slab-inventory-tracker-agent.md"),
  "utf8"
);

const client = new Anthropic();

export async function runSlabInventoryTracker(request, context = {}) {
  // Handle dashboard data requests
  if (request === "DASHBOARD_STATS") {
    return await getDashboardStats();
  }
  
  if (request === "DASHBOARD_CHARTS") {
    return await getDashboardCharts();
  }

  // Load current inventory from DB for context
  let inventory = await db.get("slab-inventory") || [];

  const systemPrompt = `${skill}

Current inventory (${inventory.length} slabs):
${JSON.stringify(inventory, null, 2)}

Context from master agent:
${JSON.stringify(context, null, 2)}

When adding or updating slabs, output the complete updated slab record
as JSON in your response so the caller can save it. Wrap slab data in
a code block labeled \`\`\`json so it can be parsed.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: request }],
  });

  const output = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();

  // Try to extract and save any slab data from the response
  try {
    const jsonMatch = output.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[1]);
      if (Array.isArray(data)) {
        await db.set("slab-inventory", data);
      } else if (data.id) {
        // Single slab — upsert into inventory
        const idx = inventory.findIndex(s => s.id === data.id);
        if (idx >= 0) inventory[idx] = data;
        else inventory.push(data);
        await db.set("slab-inventory", inventory);
      }
    }
  } catch {}

  return {
    agent: "slab-inventory-tracker-agent",
    request,
    output: output || "No output produced",
    requires_approval: false,
    approval_reason: null,
  };
}

async function getDashboardStats() {
  const inventory = await db.get("slab-inventory") || [];
  
  const stats = {
    total_slabs: inventory.length,
    available_slabs: inventory.filter(s => s.status === 'available').length,
    total_value: inventory.reduce((sum, s) => sum + (s.asking_price || 0), 0),
    avg_days_inventory: inventory.length > 0 ? 
      inventory.reduce((sum, s) => sum + (s.days_in_inventory || 0), 0) / inventory.length : 0,
    aging_slabs: inventory.filter(s => s.status === 'available' && (s.days_in_inventory || 0) > 60).length
  };

  const species_breakdown = {};
  const status_breakdown = {};
  
  inventory.forEach(slab => {
    species_breakdown[slab.species] = (species_breakdown[slab.species] || 0) + 1;
    status_breakdown[slab.status] = (status_breakdown[slab.status] || 0) + 1;
  });

  return {
    agent: "slab-inventory-tracker-agent",
    request: "DASHBOARD_STATS",
    output: {
      stats,
      species_breakdown,
      status_breakdown,
      aging_slabs: inventory.filter(s => s.status === 'available' && (s.days_in_inventory || 0) > 60)
    },
    requires_approval: false,
    approval_reason: null,
  };
}

async function getDashboardCharts() {
  const inventory = await db.get("slab-inventory") || [];
  
  // Species chart data
  const species_data = {};
  inventory.forEach(slab => {
    if (!species_data[slab.species]) {
      species_data[slab.species] = { count: 0, value: 0 };
    }
    species_data[slab.species].count++;
    species_data[slab.species].value += slab.asking_price || 0;
  });

  // Aging distribution
  const aging_buckets = {
    '0-30 days': 0,
    '31-60 days': 0,
    '61-120 days': 0,
    '120+ days': 0
  };

  inventory.forEach(slab => {
    const days = slab.days_in_inventory || 0;
    if (days <= 30) aging_buckets['0-30 days']++;
    else if (days <= 60) aging_buckets['31-60 days']++;
    else if (days <= 120) aging_buckets['61-120 days']++;
    else aging_buckets['120+ days']++;
  });

  return {
    agent: "slab-inventory-tracker-agent",
    request: "DASHBOARD_CHARTS",
    output: {
      species_chart: species_data,
      aging_chart: aging_buckets,
      timeline_data: inventory.map(s => ({
        id: s.id,
        species: s.species,
        cut_date: s.cut_date,
        days_in_inventory: s.days_in_inventory,
        status: s.status,
        value: s.asking_price
      }))
    },
    requires_approval: false,
    approval_reason: null,
  };
}