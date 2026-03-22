import * as db from "../db.js";

export async function readRegistry() {
  const registry = await db.get("registry");
  return registry;
}

export async function writeRegistry(registry) {
  await db.set("registry", registry);
}
