/**
 * LifeBridge Registry Integrity Agent Verification
 * Run with: node scripts/integrity-verify.js
 * Must run inside Replit with server running on localhost:5000
 */

import Database from "@replit/database";

const db = new Database();
const BASE = "http://localhost:5000";

async function get(key) {
  const val = await db.get(key);
  if (val === null || val === undefined) return null;
  try { return typeof val === "string" ? JSON.parse(val) : val; }
  catch { return val; }
}

async function list(prefix) {
  return (await db.list(prefix)) || [];
}

let pass = 0;
let fail = 0;

function check(name, condition, detail) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    pass++;
  } else {
    console.log(`  ❌ ${name}${detail ? " — " + detail : ""}`);
    fail++;
  }
}

async function main() {
  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log("  Registry Integrity Agent — Verification");
  console.log("═══════════════════════════════════════════════");
  console.log("");

  // 1. Registry entry
  console.log("── Registry ──");
  const registry = await get("registry");
  const entry = (registry?.agents || []).find(a => a.name === "registry-integrity-agent");
  check("Agent in registry", !!entry);
  check("Status is Active", entry?.status === "Active", entry?.status);
  check("Has endpoints", entry?.endpoints?.length > 0);

  // 2. Endpoint checks
  console.log("");
  console.log("── Endpoints ──");
  const endpoints = [
    ["GET", "/integrity/reports"],
    ["GET", "/integrity/reports/latest"],
    ["GET", "/integrity/alerts"],
  ];
  for (const [method, path] of endpoints) {
    try {
      const res = await fetch(BASE + path);
      const ct = res.headers.get("content-type") || "";
      check(`${method} ${path} → ${res.status}`, res.status === 200 && ct.includes("json"), `HTTP ${res.status}`);
    } catch (e) {
      check(`${method} ${path}`, false, e.message);
    }
  }

  // 3. Run a scan
  console.log("");
  console.log("── Live Scan ──");
  try {
    const res = await fetch(BASE + "/integrity/run", { method: "POST", headers: { "Content-Type": "application/json" } });
    const report = await res.json();
    check("POST /integrity/run succeeded", res.status === 200);
    check("Report has report_id", !!report.report_id);
    check("Report has status", ["healthy", "degraded", "critical"].includes(report.status));
    check("Report has agents_checked", typeof report.agents_checked === "number");

    console.log("");
    console.log("── Scan Results ──");
    console.log(`  Status: ${report.status}`);
    console.log(`  Agents checked: ${report.agents_checked}`);
    console.log(`  Agents healthy: ${report.agents_healthy}`);
    console.log(`  Issues: ${report.issues?.length || 0}`);
    console.log(`  Summary: ${report.summary}`);

    if (report.issues?.length > 0) {
      console.log("");
      console.log("  Issues found:");
      for (const issue of report.issues) {
        const icon = issue.severity === "critical" ? "🔴" : "🟡";
        console.log(`    ${icon} ${issue.agent_name}: ${issue.type} — ${issue.detail}`);
      }
    }
  } catch (e) {
    check("POST /integrity/run", false, e.message);
  }

  // 4. DB records
  console.log("");
  console.log("── Database Records ──");
  const reportKeys = await list("integrity-report:");
  console.log(`  Integrity reports: ${reportKeys.length}`);
  check("At least 1 report saved", reportKeys.length >= 1);

  const alertKeys = await list("system-alert:");
  console.log(`  System alerts: ${alertKeys.length}`);

  // 5. Summary
  console.log("");
  console.log("═══════════════════════════════════════════════");
  console.log(`  RESULTS: ${pass} passed, ${fail} failed`);
  console.log("═══════════════════════════════════════════════");
  console.log("");

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => {
  console.error("Verification failed:", e.message);
  process.exit(1);
});
