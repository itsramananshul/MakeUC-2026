import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { initialWorld } from "../lib/world.ts";

const path = resolve(process.env.AFTERMAP_DB_PATH || ".aftermap/drill.sqlite");
if (!process.argv.includes("--confirm") || !existsSync(path)) {
  console.error("Reset a rehearsal database with npm run drill:reset -- --confirm. Set AFTERMAP_DB_PATH for a different file.");
  process.exitCode = 1;
} else {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
  try {
    const state = initialWorld();
    const row = db.prepare("SELECT data FROM worlds WHERE code = ?").get(state.session.code);
    if (!row) throw new Error("Drill not found in this database.");
    const previous = JSON.parse(row.data);
    const previousAsset = previous.imagery?.url;
    if (previousAsset?.startsWith("/api/imagery/")) {
      db.prepare("DELETE FROM imagery WHERE id = ?").run(previousAsset.split("/").at(-1));
    }
    state.version = previous.version + 1;
    db.prepare("UPDATE worlds SET data = ? WHERE code = ?").run(JSON.stringify(state), state.session.code);
    db.exec("COMMIT");
    console.log(`Reset ${state.session.code} to version ${state.version} in ${path}`);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally { db.close(); }
}
