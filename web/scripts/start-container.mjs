import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { link, unlink, writeFile } from "node:fs/promises";

const { AFTERMAP_DB_PATH: path, AFTERMAP_DB_RESTORE_URL: url,
  AFTERMAP_DB_RESTORE_TOKEN: token, AFTERMAP_DB_RESTORE_SHA256: sha256 } = process.env;

if (url && path && !existsSync(path)) {
  if (new URL(url).protocol !== "https:" || !token || !/^[a-f\d]{64}$/i.test(sha256 ?? "")) {
    throw new Error("Set an HTTPS restore URL, a bearer token, and the backup checksum.");
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "error",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error("Could not retrieve the database snapshot.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== sha256.toLowerCase()) {
    throw new Error("The database snapshot checksum did not match.");
  }
  const staging = `${path}.${process.pid}.restore`;
  await writeFile(staging, bytes, { flag: "wx", mode: 0o600 });
  try { await link(staging, path); }
  finally { await unlink(staging); }
  console.log("Restored the verified SQLite snapshot.");
}

await import("./server.js");
