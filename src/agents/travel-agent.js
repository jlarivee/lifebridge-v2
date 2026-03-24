import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { v4 as uuidv4 } from "uuid";
import * as db from "../db.js";
import { readRegistry, writeRegistry } from "../tools/registry-tools.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const skill = readFileSync(
  join(__dirname, "../skills/travel-agent.md"),
  "utf8"
);

const client = new Anthropic();

const DEFAULT_PROFILE = {
  name: "Josh Larivee",
  preferred_airport: "BDL",
  home_airports: ["BDL", "JFK", "LGA"],
  airline: { name: "Delta", status: "Diamond Medallion", program: "SkyMiles", number: null },
  airline_preference: "Delta only — Diamond Medallion status",
  hotels: [
    { chain: "Hilton", program: "Hilton Honors", status: "Diamond", number: null },
    { chain: "Marriott", program: "Marriott Bonvoy", status: "Platinum Elite", number: null },
  ],
  hotel_programs: ["Hilton Honors (Diamond)", "Marriott Bonvoy (Platinum Elite)"],
  car_rental: { company: "National", program: "National Executive", status: "Executive Elite", class: "Full-size or above, Executive Aisle" },
  loyalty: {
    delta: { program: "SkyMiles", status: "Diamond Medallion", number: null },
    hilton: { program: "Hilton Honors", status: "Diamond", number: null },
    marriott: { program: "Marriott Bonvoy", status: "Platinum Elite", number: null },
    national: { program: "National Executive", status: "Executive Elite", number: null },
  },
  preferences: {
    seat: "Aisle, forward cabin, Comfort+ or First",
    hotel_room: "King bed, high floor, points-eligible rate",
    car_class: "Full-size or above, Executive Aisle",
  },
  seat_preference: "Aisle, forward cabin, Comfort+ or First",
  hotel_preference: "King bed, high floor, points-eligible rate",
  hard_constraints: {
    airline: "Delta only",
    hotel: "Hilton or Marriott only",
    car_rental: "National only",
  },
  price_thresholds: {
    domestic_rt_max: 600,
    international_rt_max: 1500,
  },
  frequent_destinations: [
    { code: "IND", name: "Indianapolis", purpose: "work", notes: "AWS meetings" },
    { code: "ZRH", name: "Zurich", purpose: "work", notes: "Novartis / Basel" },
    { code: "RDU", name: "Raleigh-Durham", purpose: "work", notes: "AWS meetings" },
    { code: "BLQ", name: "Bologna", purpose: "personal", notes: "Family roots / Italy" },
  ],
  travel_types: ["work", "personal", "concert"],
  updated_at: new Date().toISOString(),
};

export async function registerTravelAgent() {
  const registry = await readRegistry();
  const exists = (registry.agents || []).some(a => a.name === "travel-agent");
  if (!exists) {
    registry.agents = registry.agents || [];
    registry.agents.push({
      name: "travel-agent",
      domain: "Personal Life",
      purpose: "Trip planning with Josh's preferences — Delta Diamond, Hilton Diamond, Marriott Platinum, National Executive. Handles work travel, family trips, weekend getaways, international trips, concert travel. Monitors flight prices, tracks loyalty points, manages travel docs.",
      status: "Active",
      skill_file: "src/skills/travel-agent.md",
      code_file: "src/agents/travel-agent.js",
      trigger_patterns: ["travel", "trip", "flight", "hotel", "car rental", "Delta", "Hilton", "Marriott", "airport", "Italy", "Bologna", "vacation", "getaway"],
      triggers: ["scheduled_daily_8am_flight_watch", "scheduled_monthly_1st_doc_expiry", "scheduled_weekly_sunday_loyalty", "manual"],
      endpoints: ["/agents/travel-agent/health", "/agents/travel-agent", "/travel/profile", "/travel/trips", "/travel/trips/:id", "/travel/flights/watch", "/travel/flights/watch/:id", "/travel/loyalty", "/travel/loyalty/history", "/travel/loyalty/:id", "/travel/docs", "/travel/docs/:name"],
      requires_approval: ["booking", "purchasing", "external_alerts"],
      created_at: new Date().toISOString(),
    });
    await writeRegistry(registry);
    console.log("Registered: travel-agent");
  }
}

export async function initTravelProfile() {
  const existing = await db.get("travel-profile");
  if (!existing) {
    await db.set("travel-profile", DEFAULT_PROFILE);
  } else {
    let updated = false;
    for (const key of Object.keys(DEFAULT_PROFILE)) {
      if (!(key in existing)) {
        existing[key] = DEFAULT_PROFILE[key];
        updated = true;
      }
    }
    if (updated) {
      existing.updated_at = new Date().toISOString();
      await db.set("travel-profile", existing);
    }
  }
  console.log("Travel Agent registered — Delta Diamond, Hilton Diamond, Marriott Platinum preferences loaded");
}

function detectIntent(request) {
  const lower = request.toLowerCase();
  if (lower.includes("flight watch") || lower.includes("price watch") || lower.includes("watch") && (lower.includes("flight") || lower.includes("price"))) return "create_flight_watch";
  if (lower.includes("loyalty") && (lower.includes("update") || lower.includes("balance") || lower.includes("point") || lower.includes("snapshot"))) return "update_loyalty";
  if (lower.includes("passport") || lower.includes("visa") || lower.includes("document") || lower.includes("global entry") || lower.includes("tsa pre")) return "manage_doc";
  if (lower.includes("plan") || lower.includes("trip") || lower.includes("travel to") || lower.includes("book") || lower.includes("fly to") || lower.includes("hotel") || lower.includes("going to")) return "plan_trip";
  return "general_advice";
}

export async function runTravelAgent(request, context = {}) {
  const profile = await db.get("travel-profile") || DEFAULT_PROFILE;
  const intent = detectIntent(request);

  const tripKeys = await db.list("trip:");
  const trips = [];
  for (const key of tripKeys) {
    const trip = await db.get(key);
    if (trip) trips.push(trip);
  }

  const watchKeys = await db.list("flight-watch:");
  const activeWatches = [];
  for (const key of watchKeys) {
    const w = await db.get(key);
    if (w && w.status === "active") activeWatches.push(w);
  }

  const systemPrompt = `${skill}

Current Travel Profile:
${JSON.stringify(profile, null, 2)}

Active Trips (${trips.length}):
${JSON.stringify(trips.slice(0, 10), null, 2)}

Active Flight Watches (${activeWatches.length}):
${JSON.stringify(activeWatches.slice(0, 10), null, 2)}

Context:
${JSON.stringify(context, null, 2)}

Detected intent: ${intent}

IMPORTANT: Return your response as a structured JSON object wrapped in a code block:
\`\`\`json
{
  "action": "plan_trip|create_flight_watch|update_loyalty|manage_doc|general_advice|status_update",
  "response_text": "your human-readable response here",
  "trip_plan": {
    "destination": "city",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD",
    "purpose": "work|personal|concert",
    "flights": [{ "route": "BDL-ATL-IND", "airline": "Delta", "class": "Comfort+", "estimated_cost": "$XXX" }],
    "hotels": [{ "name": "hotel name", "chain": "Hilton|Marriott", "rate": "$XXX/night", "loyalty_rate": true }],
    "car_rental": { "company": "National", "class": "Full-size", "estimated_cost": "$XX/day" },
    "estimated_total": "$XXXX",
    "notes": "additional recommendations"
  },
  "flight_watch": {
    "route_from": "BDL",
    "route_to": "IND",
    "date_range": { "depart": "YYYY-MM-DD", "return": "YYYY-MM-DD" },
    "price_threshold_usd": 500,
    "international": false,
    "notes": "optional notes"
  },
  "loyalty_update": {
    "program": "Delta SkyMiles|Hilton Honors|Marriott Bonvoy|National Executive",
    "points": 285000,
    "status": "Diamond Medallion",
    "notes": "optional notes"
  },
  "travel_doc": {
    "name": "passport",
    "document_type": "passport|visa|global_entry|tsa_precheck|drivers_license",
    "expiry_date": "YYYY-MM-DD",
    "alert_days_before": 180,
    "notes": "optional notes"
  }
}
\`\`\`
Include only the relevant sub-object for the detected action. Omit sub-objects that don't apply.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: systemPrompt,
    tools: [{ type: "web_search_20250305", name: "web_search" }],
    messages: [{ role: "user", content: request }],
  });

  const output = response.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("")
    .trim();

  let parsed = null;
  try {
    const jsonMatch = output.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      parsed = JSON.parse(jsonMatch[1]);
    }
  } catch {}

  const responseText = parsed?.response_text || output;
  const actionTaken = parsed?.action || intent;
  const result = {
    agent: "travel-agent",
    output: responseText,
    success: true,
    action_taken: actionTaken,
  };

  if (parsed?.trip_plan) {
    const trip = {
      id: uuidv4(),
      ...parsed.trip_plan,
      status: "planning",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      source_request: request,
    };
    await db.set(`trip:${trip.id}`, trip);
    result.trip = trip;
  }

  if (parsed?.flight_watch) {
    const watch = {
      id: uuidv4(),
      ...parsed.flight_watch,
      status: "active",
      price_history: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await db.set(`flight-watch:${watch.id}`, watch);
    result.flight_watch = watch;
  }

  if (parsed?.loyalty_update) {
    const snapshot = {
      id: uuidv4(),
      ...parsed.loyalty_update,
      created_at: new Date().toISOString(),
    };
    await db.set(`loyalty-snapshot:${snapshot.id}`, snapshot);
    result.loyalty_snapshot = snapshot;
  }

  if (parsed?.travel_doc) {
    const name = parsed.travel_doc.name || parsed.travel_doc.document_type || uuidv4();
    const doc = {
      ...parsed.travel_doc,
      name,
      alert_days_before: parsed.travel_doc.alert_days_before || 180,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await db.set(`travel-doc:${name}`, doc);
    result.travel_doc = doc;
  }

  return result;
}

export async function getProfile() {
  return await db.get("travel-profile") || DEFAULT_PROFILE;
}

export async function updateProfile(updates) {
  const profile = await db.get("travel-profile") || DEFAULT_PROFILE;
  Object.assign(profile, updates, { updated_at: new Date().toISOString() });
  await db.set("travel-profile", profile);
  return profile;
}

export async function getTrips() {
  const keys = await db.list("trip:");
  const trips = [];
  for (const key of keys) {
    const trip = await db.get(key);
    if (trip) trips.push(trip);
  }
  trips.sort((a, b) => (b.start_date || b.created_at || "").localeCompare(a.start_date || a.created_at || ""));
  return trips;
}

export async function getTrip(id) {
  return await db.get(`trip:${id}`);
}

export async function createTrip(tripData) {
  const trip = {
    id: uuidv4(),
    ...tripData,
    status: tripData.status || "planning",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await db.set(`trip:${trip.id}`, trip);
  return trip;
}

export async function updateTrip(id, updates) {
  const trip = await db.get(`trip:${id}`);
  if (!trip) return null;
  Object.assign(trip, updates, { updated_at: new Date().toISOString() });
  await db.set(`trip:${id}`, trip);
  return trip;
}

export async function deleteTrip(id) {
  const trip = await db.get(`trip:${id}`);
  if (!trip) return null;
  trip.status = "cancelled";
  trip.updated_at = new Date().toISOString();
  await db.set(`trip:${id}`, trip);
  return trip;
}

export async function getFlightWatches(includeInactive = false) {
  const keys = await db.list("flight-watch:");
  const watches = [];
  for (const key of keys) {
    const w = await db.get(key);
    if (w && (includeInactive || w.status === "active")) watches.push(w);
  }
  watches.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return watches;
}

export async function getFlightWatch(id) {
  return await db.get(`flight-watch:${id}`);
}

export async function createFlightWatch(watchData) {
  const watch = {
    id: uuidv4(),
    route_from: watchData.route_from || watchData.origin || null,
    route_to: watchData.route_to || watchData.destination || null,
    date_range: watchData.date_range || { depart: watchData.depart_date || null, return: watchData.return_date || null },
    price_threshold_usd: watchData.price_threshold_usd || watchData.current_price || null,
    international: watchData.international || false,
    notes: watchData.notes || null,
    status: "active",
    price_history: watchData.price_threshold_usd ? [{ price: watchData.price_threshold_usd, checked_at: new Date().toISOString(), source: "initial" }] : [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await db.set(`flight-watch:${watch.id}`, watch);
  return watch;
}

export async function updateFlightWatch(id, updates) {
  const watch = await db.get(`flight-watch:${id}`);
  if (!watch) return null;
  Object.assign(watch, updates, { updated_at: new Date().toISOString() });
  await db.set(`flight-watch:${id}`, watch);
  return watch;
}

export async function deleteFlightWatch(id) {
  const watch = await db.get(`flight-watch:${id}`);
  if (!watch) return null;
  watch.status = "cancelled";
  watch.updated_at = new Date().toISOString();
  await db.set(`flight-watch:${id}`, watch);
  return watch;
}

export async function getLoyaltySnapshots() {
  const keys = await db.list("loyalty-snapshot:");
  const snapshots = [];
  for (const key of keys) {
    const s = await db.get(key);
    if (s) snapshots.push(s);
  }
  snapshots.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  return snapshots;
}

export async function getLatestLoyaltySnapshot() {
  const snapshots = await getLoyaltySnapshots();
  if (snapshots.length === 0) return null;

  const latestByProgram = {};
  for (const s of snapshots) {
    if (!latestByProgram[s.program] || s.created_at > latestByProgram[s.program].created_at) {
      latestByProgram[s.program] = s;
    }
  }

  return {
    snapshot_at: snapshots[0].created_at,
    skymiles: latestByProgram["Delta SkyMiles"] || latestByProgram["delta"] || null,
    hilton_honors: latestByProgram["Hilton Honors"] || latestByProgram["hilton"] || null,
    marriott_bonvoy: latestByProgram["Marriott Bonvoy"] || latestByProgram["marriott"] || null,
    national_executive: latestByProgram["National Executive"] || latestByProgram["national"] || null,
    all_programs: latestByProgram,
    total_snapshots: snapshots.length,
  };
}

export async function getLoyaltySnapshot(id) {
  return await db.get(`loyalty-snapshot:${id}`);
}

export async function createLoyaltySnapshot(snapshotData) {
  const snapshot = {
    id: uuidv4(),
    program: snapshotData.program || null,
    points: snapshotData.points || 0,
    status: snapshotData.status || null,
    nights_to_requalify: snapshotData.nights_to_requalify || null,
    mqms_to_requalify: snapshotData.mqms_to_requalify || null,
    points_expiring_90_days: snapshotData.points_expiring_90_days || null,
    notes: snapshotData.notes || null,
    ...snapshotData,
    created_at: new Date().toISOString(),
  };
  await db.set(`loyalty-snapshot:${snapshot.id}`, snapshot);

  if (snapshot.points_expiring_90_days && snapshot.points_expiring_90_days > 0) {
    await db.set(`system-alert:${uuidv4()}`, {
      id: uuidv4(),
      created_at: new Date().toISOString(),
      severity: "warning",
      source: "travel-agent",
      message: `${snapshot.program}: ${snapshot.points_expiring_90_days} points expiring within 90 days`,
      snapshot_id: snapshot.id,
      acknowledged: false,
    });
  }

  return snapshot;
}

export async function updateLoyaltySnapshot(id, updates) {
  const snapshot = await db.get(`loyalty-snapshot:${id}`);
  if (!snapshot) return null;
  Object.assign(snapshot, updates);
  await db.set(`loyalty-snapshot:${id}`, snapshot);
  return snapshot;
}

export async function deleteLoyaltySnapshot(id) {
  const snapshot = await db.get(`loyalty-snapshot:${id}`);
  if (!snapshot) return null;
  snapshot.status = "archived";
  await db.set(`loyalty-snapshot:${id}`, snapshot);
  return snapshot;
}

export async function getTravelDocs() {
  const keys = await db.list("travel-doc:");
  const docs = [];
  const now = new Date();
  for (const key of keys) {
    const d = await db.get(key);
    if (d) {
      if (d.expiry_date) {
        const expiry = new Date(d.expiry_date);
        const diffDays = Math.ceil((expiry.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
        d.days_until_expiry = diffDays;
        d.expiry_status = diffDays < 0 ? "expired" : diffDays <= 30 ? "expiring_soon" : diffDays <= 180 ? "approaching" : "valid";
      }
      docs.push(d);
    }
  }
  docs.sort((a, b) => (a.days_until_expiry ?? 9999) - (b.days_until_expiry ?? 9999));
  return docs;
}

export async function getTravelDoc(name) {
  return await db.get(`travel-doc:${name}`);
}

export async function createTravelDoc(docData) {
  const name = docData.name || docData.document_name || uuidv4();
  const doc = {
    ...docData,
    name,
    alert_days_before: docData.alert_days_before || 180,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await db.set(`travel-doc:${name}`, doc);
  return doc;
}

export async function updateTravelDoc(name, updates) {
  const doc = await db.get(`travel-doc:${name}`);
  if (!doc) return null;
  Object.assign(doc, updates, { updated_at: new Date().toISOString() });
  await db.set(`travel-doc:${name}`, doc);
  return doc;
}

export async function deleteTravelDoc(name) {
  const doc = await db.get(`travel-doc:${name}`);
  if (!doc) return null;
  doc.status = "archived";
  doc.updated_at = new Date().toISOString();
  await db.set(`travel-doc:${name}`, doc);
  return doc;
}

export async function checkFlightWatches() {
  const watches = await getFlightWatches();
  const active = watches.filter(w => w.status === "active");
  if (active.length === 0) return;

  for (const watch of active) {
    try {
      const routeFrom = watch.route_from || "BDL";
      const routeTo = watch.route_to || "unknown";
      const departDate = watch.date_range?.depart || "upcoming";

      const response = await client.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: "You are a flight price checker. Search for current prices on the given route and dates. Return only a JSON object: {\"current_price\": number, \"price_trend\": \"up|down|stable\", \"note\": \"brief note\"}",
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{ role: "user", content: `Check Delta flight prices: ${routeFrom} to ${routeTo} on ${departDate}${watch.date_range?.return ? `, returning ${watch.date_range.return}` : ""}` }],
      });

      const text = response.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
      let priceData;
      try {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}") + 1;
        priceData = JSON.parse(text.slice(start, end));
      } catch {
        continue;
      }

      if (priceData?.current_price) {
        watch.price_history = watch.price_history || [];
        watch.price_history.push({ price: priceData.current_price, checked_at: new Date().toISOString() });
        watch.last_checked = new Date().toISOString();
        watch.updated_at = new Date().toISOString();
        await db.set(`flight-watch:${watch.id}`, watch);

        const threshold = watch.price_threshold_usd;
        if (threshold && priceData.current_price <= threshold) {
          await db.set(`system-alert:${uuidv4()}`, {
            id: uuidv4(),
            created_at: new Date().toISOString(),
            severity: "info",
            source: "travel-agent",
            message: `Flight watch ${routeFrom}→${routeTo}: $${priceData.current_price} dropped below threshold $${threshold} — good time to book!`,
            watch_id: watch.id,
            acknowledged: false,
          });
        }
      }
    } catch (e) {
      console.error(`[TRAVEL] Flight watch check failed for ${watch.id}: ${e.message}`);
    }
  }
  console.log(`[TRAVEL] Flight watch check complete — ${active.length} watches checked`);
}

export async function checkDocExpiry() {
  const docs = await getTravelDocs();
  const now = new Date();

  for (const doc of docs) {
    if (!doc.expiry_date) continue;
    const expiry = new Date(doc.expiry_date);
    const diff = expiry.getTime() - now.getTime();
    const daysUntil = Math.ceil(diff / (24 * 60 * 60 * 1000));
    const alertWindow = doc.alert_days_before || 180;

    let severity = null;
    if (diff < 0) severity = "critical";
    else if (daysUntil <= 30) severity = "warning";
    else if (daysUntil <= alertWindow) severity = "info";

    if (severity) {
      const message = diff < 0
        ? `Travel document "${doc.name}" EXPIRED ${Math.abs(daysUntil)} days ago`
        : `Travel document "${doc.name}" expires in ${daysUntil} days`;

      await db.set(`system-alert:${uuidv4()}`, {
        id: uuidv4(),
        created_at: new Date().toISOString(),
        severity,
        source: "travel-agent",
        message,
        doc_name: doc.name,
        expiry_date: doc.expiry_date,
        acknowledged: false,
      });
    }
  }
  console.log(`[TRAVEL] Document expiry check complete — ${docs.length} docs checked`);
}

export async function sendLoyaltyReminder() {
  const profile = await db.get("travel-profile") || DEFAULT_PROFILE;
  const snapshots = await getLoyaltySnapshots();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recentSnapshot = snapshots.find(s => s.created_at > sevenDaysAgo);
  if (recentSnapshot) {
    console.log("[TRAVEL] Weekly loyalty reminder skipped — snapshot updated within 7 days");
    return;
  }

  const latestByProgram = {};
  for (const s of snapshots) {
    if (!latestByProgram[s.program] || s.created_at > latestByProgram[s.program].created_at) {
      latestByProgram[s.program] = s;
    }
  }

  const reminder = {
    id: uuidv4(),
    created_at: new Date().toISOString(),
    severity: "info",
    source: "travel-agent",
    message: `Weekly loyalty reminder — Status: Delta ${profile.loyalty.delta.status}, Hilton ${profile.loyalty.hilton.status}, Marriott ${profile.loyalty.marriott.status}, National ${profile.loyalty.national.status}. Please update your loyalty point balances.`,
    latest_snapshots: latestByProgram,
    acknowledged: false,
  };

  await db.set(`system-alert:${reminder.id}`, reminder);
  console.log("[TRAVEL] Weekly loyalty reminder sent");
}
