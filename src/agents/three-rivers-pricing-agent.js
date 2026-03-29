/**
 * Three Rivers Pricing Agent
 * Researches market comps and generates Facebook Marketplace listings
 * for wood slabs sold by Three Rivers Slab Co.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const skill = readFileSync(
  join(__dirname, "../skills/three-rivers-pricing-agent.md"),
  "utf8"
);

const client = new Anthropic();

export const AGENT_META = {
  name: "three-rivers-pricing-agent",
  domain: "Three Rivers",
  purpose: "Research market comps and generate Facebook Marketplace listings for wood slabs",
  status: "Active",
  trigger_patterns: ["price slab", "slab pricing", "marketplace listing", "three rivers pricing"],
  endpoints: ["/agents/three-rivers-pricing-agent"],
  requires_approval: [],
};

// ── Board feet & figure premium ──────────────────────────────────────────────

const FIGURE_PREMIUMS = { none: 1.0, low: 1.1, high: 1.25, exceptional: 1.4 };

function calcBoardFeet(length, width, thickness) {
  if (!length || !width || !thickness) return null;
  return Math.round((length * width * thickness / 144) * 100) / 100;
}

// ── Parse incoming request ───────────────────────────────────────────────────

function parseSlab(request) {
  if (typeof request === "object" && request !== null) return request;
  if (typeof request === "string") {
    try { return JSON.parse(request); } catch {}
  }
  // Natural language fallback — pass as-is and let Claude extract
  return { raw_request: request };
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function runThreeRiversPricingAgent(request, context = {}) {
  const slab = parseSlab(request);

  const bf = calcBoardFeet(
    slab.length_inches, slab.width_inches, slab.thickness_inches
  );
  const figure = (slab.figure || "none").toLowerCase();
  const premium = FIGURE_PREMIUMS[figure] ?? 1.0;

  // Build the user message
  const userMessage = slab.raw_request
    ? slab.raw_request
    : [
        `Price this slab and generate a Facebook Marketplace listing.`,
        `Species: ${slab.species || "unknown"}`,
        `Dimensions: ${slab.length_inches}"L × ${slab.width_inches}"W × ${slab.thickness_inches}"T`,
        `Board feet (pre-calculated): ${bf ?? "calculate from dimensions"}`,
        `Figure: ${figure} (premium multiplier: ×${premium})`,
        slab.notes ? `Notes: ${slab.notes}` : null,
      ].filter(Boolean).join("\n");

  const systemPrompt = `${skill}

PRE-CALCULATED VALUES (use these, do not recalculate):
- Board feet: ${bf ?? "not pre-calculated — derive from dimensions"}
- Figure premium multiplier: ×${premium} (${figure} figure)

SEARCH INSTRUCTIONS:
Search for: "${slab.species || ""} live edge slab ${slab.length_inches || ""}x${slab.width_inches || ""} for sale"
Pull 3–5 comparable listings. If fewer than 3 results, also search: "${slab.species || ""} live edge slab for sale"
Extract price and $/board-foot from each comp.

OUTPUT: Respond with a JSON code block (exactly as specified in the skill), then a plain-text summary.`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: systemPrompt,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      messages: [{ role: "user", content: [{ type: "text", text: userMessage }] }],
    });

    const text = response.content
      .filter(b => b.type === "text")
      .map(b => b.text)
      .join("")
      .trim();

    // Parse structured JSON from the code block
    let structured = null;
    const jsonMatch = text.match(/```json\s*([\s\S]+?)\s*```/);
    if (jsonMatch) {
      try {
        structured = JSON.parse(jsonMatch[1]);
      } catch (parseErr) {
        // JSON malformed — we'll still return text output
      }
    }

    // Validate minimum required fields
    if (structured && (!structured.listing || !structured.price_range)) {
      structured = null; // treat as parse failure if shape is wrong
    }

    return {
      agent: "three-rivers-pricing-agent",
      request: typeof request === "string" ? request : JSON.stringify(request),
      output: text,
      success: true,
      requires_approval: false,
      approval_reason: null,
      tokens_used: response.usage?.input_tokens + response.usage?.output_tokens || 0,
      // Hoist structured fields to top level for easy consumption
      board_feet: structured?.board_feet ?? bf,
      price_range: structured?.price_range ?? null,
      recommended_price: structured?.recommended_price ?? null,
      comps: structured?.comps ?? [],
      listing: structured?.listing ?? null,
      pricing_notes: structured?.pricing_notes ?? null,
    };
  } catch (e) {
    return {
      agent: "three-rivers-pricing-agent",
      request: typeof request === "string" ? request : JSON.stringify(request),
      output: `Pricing agent error: ${e.message}`,
      success: false,
      requires_approval: false,
      approval_reason: null,
      board_feet: bf,
      price_range: null,
      recommended_price: null,
      comps: [],
      listing: null,
    };
  }
}
