/**
 * LifeBridge Safe Config — URL helpers
 * Always use getDashboardUrl() instead of hardcoding localhost or replit.app URLs.
 * This ensures correct URLs in both local dev and production (Replit) environments.
 */

const PORT = process.env.PORT || 5000;

/**
 * Returns the base URL for the LifeBridge dashboard.
 * - In production (Replit): uses REPLIT_URL env var
 * - In local dev: uses http://localhost:{PORT}
 * Never hardcode localhost or a specific Replit URL anywhere — use this function.
 */
export function getDashboardUrl() {
  if (process.env.REPLIT_URL) return process.env.REPLIT_URL;
  return `http://localhost:${PORT}`;
}

/**
 * Returns the base URL for internal server-to-server API calls.
 * Uses BASE_URL if set (recommended in .env.local), otherwise falls back to localhost.
 */
export function getBaseUrl() {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  if (process.env.REPLIT_URL) return process.env.REPLIT_URL;
  return `http://localhost:${PORT}`;
}
