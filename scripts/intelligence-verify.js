/**
 * LifeBridge Intelligence Update Agent Verification
 * Run with: node scripts/intelligence-verify.js
 * Server must be running on localhost:5000
 */

import Database from "@replit/database";

const db = new Database();
const BASE = "http://localhost:5000";
let pass = 0, fail = 0;

async function get(key) {
  const val = await db.get(key);
  if (val === null || val === undefined) return null;
  try { return typeof val === "string" ? JSON.parse(val) : val; }
  catch { return val; }
}

function check(name, ok, detail) {
  if (ok) { console.log(`  ✅ ${name}`); pass++; }
  else { console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`); fail++; }
}

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log("  Intelligence Update Agent — Verification");
  console.log("═══════════════════════════════════════════════");
  console.log("");

  // 1. Registry
  console.log("── Registry ──");
  const registry = await get("registry");
  const entry = (registry?.agents || []).find(a => a.name === "intelligence-update-agent");
  check("Agent in registry", !!entry);
  check("Status is Active", entry?.status === "Active" || entry?.status === "active");

  // 2. Endpoints respond
  console.log("");
  console.log("── Endpoints ──");
  for (const [method, path] of [
    ["GET", "/intelligence/sources"],
    ["GET", "/intelligence/findings"],
  ]) {
    try {
      const res = await fetch(BASE + path);
      const ct = res.headers.get("content-type") || "";
      check(`${method} ${path} → ${res.status}`, res.status === 200 && ct.includes("json"));
    } catch (e) { check(`${method} ${path}`, false, e.message); }
  }

  // 3. Sources check
  console.log("");
  console.log("── Sources ──");
  try {
    const res = await fetch(BASE + "/intelligence/sources");
    const sources = await res.json();
    check("Sources returned", Array.isArray(sources));
    check("Has 6 sources", sources.length === 6, `got ${sources.length}`);
    for (const s of sources) {
      console.log(`     ${s.name}: last scanned ${s.last_scanned_at || "never"}, failures: ${s.consecutive_failures || 0}`);
    }
  } catch (e) { check("Sources endpoint", false, e.message); }

  // 4. Live scan (uses Anthropic API)
  console.log("");
  console.log("── Live Scan (this takes 30-60 seconds) ──");
  try {
    const res = await fetch(BASE + "/intelligence/run", { method: "POST", headers: { "Content-Type": "application/json" } });
    const result = await res.json();
    check("POST /intelligence/run succeeded", res.status === 200);
    check("Has scan_id", !!result.scan_id);
    check("Has scanned_at", !!result.scanned_at);
    check("Has findings_count", typeof result.findings_count === "number");
    console.log(`     Found: ${result.findings_count} items`);
    console.log(`     Surfaced: ${result.surfaced_count} (score >= 6)`);
    console.log(`     Sources OK: ${result.sources_scanned}, Failed: ${result.sources_failed}`);
    console.log(`     Summary: ${result.summary}`);
  } catch (e) { check("Live scan", false, e.message); }

  // 5. DB records
  console.log("");
  console.log("── Database Records ──");
  const intelKeys = await db.list("intelligence:");
  check("Findings saved to DB", intelKeys.length > 0, `${intelKeys.length} found`);
  console.log(`     Intelligence findings: ${intelKeys.length}`);

  const lastRun = await get("intel-last-run");
  check("Last run record exists", !!lastRun);
  if (lastRun) console.log(`     Last run: ${lastRun.run_at}`);

  // Summary
  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log(`  RESULTS: ${pass} passed, ${fail} failed`);
  console.log("═══════════════════════════════════════════════");
  console.log("");

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error("Failed:", e.message); process.exit(1); });
