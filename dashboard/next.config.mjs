import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load the project's root .env so the dashboard gets the same config as the Python lanes
// on a fresh clone — no per-machine symlink or copy needed. Existing process.env values
// (and Next's own .env.local) win, so this only fills in what's missing.
function loadRootEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, "..", ".env");
  let raw;
  try {
    raw = fs.readFileSync(envPath, "utf8");
  } catch {
    return; // no root .env (e.g. each var set some other way) — nothing to do
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue; // skip blanks/comments
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    } else {
      val = val.replace(/\s+#.*$/, "").trim(); // strip trailing inline comments
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadRootEnv();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ioredis is server-only; keep it external from the client bundle.
  experimental: { serverComponentsExternalPackages: ["ioredis"] },
};
export default nextConfig;
