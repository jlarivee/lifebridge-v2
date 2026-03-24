/**
 * Italy 2026 Connector
 * Read-only connector to the Italy 2026 family trip planning app.
 * Fetches live trip data with 1-hour caching.
 */

import * as db from "../db.js";

const CACHE_KEY = "italy2026-cache";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function getConfig() {
  return {
    url: process.env.ITALY2026_URL || "",
    key: process.env.ITALY2026_API_KEY || "",
  };
}

export async function getItaly2026Health() {
  const { url } = getConfig();
  if (!url) return { reachable: false, latency_ms: 0, error: "ITALY2026_URL not set" };

  const start = Date.now();
  try {
    const resp = await fetch(`${url}/api/lifebridge/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const latency_ms = Date.now() - start;
    if (!resp.ok) return { reachable: false, latency_ms, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    return { reachable: true, latency_ms, ...data };
  } catch (e) {
    return { reachable: false, latency_ms: Date.now() - start, error: e.message };
  }
}

export async function getItaly2026Data() {
  // Check cache first
  const cached = await db.get(CACHE_KEY);
  if (cached && cached.fetched_at) {
    const age = Date.now() - new Date(cached.fetched_at).getTime();
    if (age < CACHE_TTL_MS) {
      return { available: true, from_cache: true, ...cached.data };
    }
  }

  // Fetch fresh
  const { url, key } = getConfig();
  if (!url || !key) {
    return { available: false, error: "ITALY2026_URL or ITALY2026_API_KEY not set" };
  }

  try {
    const resp = await fetch(`${url}/api/lifebridge`, {
      headers: { "x-lifebridge-key": key },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      return { available: false, error: `HTTP ${resp.status}` };
    }
    const data = await resp.json();

    // Cache the result
    await db.set(CACHE_KEY, {
      fetched_at: new Date().toISOString(),
      data,
    });

    return { available: true, from_cache: false, ...data };
  } catch (e) {
    // If fetch fails, try serving stale cache
    if (cached && cached.data) {
      return { available: true, from_cache: true, stale: true, ...cached.data };
    }
    return { available: false, error: e.message };
  }
}
