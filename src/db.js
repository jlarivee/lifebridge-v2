import Database from "@replit/database";

let _db = null;

export function getDB() {
  if (!_db) {
    _db = new Database();
  }
  return _db;
}

export async function get(key) {
  const db = getDB();
  const val = await db.get(key);
  if (val === null || val === undefined) return null;
  try {
    return typeof val === "string" ? JSON.parse(val) : val;
  } catch {
    return val;
  }
}

export async function set(key, value) {
  const db = getDB();
  await db.set(key, JSON.stringify(value));
}

export async function list(prefix) {
  const db = getDB();
  const keys = await db.list(prefix);
  return keys || [];
}

export async function initDefaults() {
  const registry = await get("registry");
  if (!registry) {
    await set("registry", {
      agents: [],
      connectors: [],
      domain_signals: [],
      claude_capabilities: [
        "web_search",
        "code_execution",
        "file_reading",
        "api_calls",
        "artifact_creation",
        "structured_reasoning",
        "skill_invocation"
      ]
    });
  }

  const context = await get("context");
  if (!context) {
    await set("context", {
      preferences: [],
      constraints: [],
      learned_patterns: [],
      last_updated: null
    });
  }

  // Seed Italy 2026 connector config if not already set
  const italy2026Config = await get("italy2026-config");
  if (!italy2026Config) {
    await set("italy2026-config", {
      url: "https://italy-2026.replit.app",
      key: "534fb8d02b8670c565179ce414255f31"
    });
    console.log("[DB] Seeded italy2026-config");
  }
}
