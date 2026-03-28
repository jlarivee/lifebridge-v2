import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_DB_PATH = path.join(__dirname, "../data/local-db.json");
const IS_LOCAL = process.env.LOCAL_DEV === "true";

// ── Local file-based DB (same API as @replit/database) ─────────────────────

class LocalDatabase {
  constructor() {
    this._store = {};
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(LOCAL_DB_PATH)) {
        this._store = JSON.parse(fs.readFileSync(LOCAL_DB_PATH, "utf-8"));
      }
    } catch {
      this._store = {};
    }
  }

  _save() {
    const dir = path.dirname(LOCAL_DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LOCAL_DB_PATH, JSON.stringify(this._store, null, 2));
  }

  async get(key) {
    return this._store[key] ?? null;
  }

  async set(key, val) {
    if (val === null) {
      delete this._store[key];
    } else {
      this._store[key] = val;
    }
    this._save();
  }

  async list(prefix = "") {
    return Object.keys(this._store).filter(k => k.startsWith(prefix));
  }

  async delete(key) {
    delete this._store[key];
    this._save();
  }
}

// ── Database singleton ─────────────────────────────────────────────────────

let _db = null;
let _dbReady = null;

async function _initDB() {
  if (IS_LOCAL) {
    _db = new LocalDatabase();
    console.log("[DB] Using local file-based database");
  } else {
    try {
      const { default: Database } = await import("@replit/database");
      _db = new Database();
      console.log("[DB] Using Replit Database");
    } catch {
      console.warn("[DB] @replit/database not available, falling back to local DB");
      _db = new LocalDatabase();
    }
  }
  return _db;
}

export function getDB() {
  if (_db) return _db;
  // Synchronous fallback — if called before init, use local
  if (IS_LOCAL) {
    _db = new LocalDatabase();
    return _db;
  }
  throw new Error("DB not initialized — call await ensureDB() first");
}

export async function ensureDB() {
  if (_db) return _db;
  if (!_dbReady) _dbReady = _initDB();
  return _dbReady;
}

// ── Public API (unchanged) ─────────────────────────────────────────────────

export async function get(key) {
  await ensureDB();
  const val = await _db.get(key);
  if (val === null || val === undefined) return null;
  try {
    return typeof val === "string" ? JSON.parse(val) : val;
  } catch {
    return val;
  }
}

export async function set(key, value) {
  await ensureDB();
  await _db.set(key, JSON.stringify(value));
}

export async function list(prefix) {
  await ensureDB();
  const keys = await _db.list(prefix);
  return keys || [];
}

export async function initDefaults() {
  await ensureDB();

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

// Export for other modules that need a raw DB instance
export { LocalDatabase };
