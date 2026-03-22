import * as db from "../db.js";

export async function readContext() {
  const context = await db.get("context");
  return context;
}

export async function writeContext(context) {
  await db.set("context", context);
}
