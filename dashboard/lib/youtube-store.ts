// Storage for connected YouTube accounts (Lane D add-on).
//
// IMPORTANT: these youtube:* keys are dashboard-internal and are NOT part of the Redis
// contract (§4 in CLAUDE.md) — no other lane reads them. To make the connect/upload flow
// "just work" on a fresh clone (e.g. a teammate who hasn't started Redis), this store
// prefers Redis when it's reachable and transparently falls back to a per-machine JSON
// file otherwise. The choice is probed once per process and cached.
import fs from "fs";
import os from "os";
import path from "path";
import Redis from "ioredis";
import { redis } from "@/lib/redis";

export interface YouTubeAccount {
  channel_id: string;
  channel_title: string;
  thumbnail: string;
  email: string;
  refresh_token: string;
  access_token: string;
  expiry_date: string; // ms epoch as string
  connected_at: string;
}

const ACTIVE_KEY = "youtube:active";
const ACCOUNTS_SET = "youtube:accounts";
const accountKey = (id: string) => `youtube:account:${id}`;

// --- File backend (fallback when Redis isn't available) ---
// Lives in the user's home dir (outside the repo) so it never gets committed and is
// naturally per-machine. Override with YT_STORE_FILE if desired.
const FILE =
  process.env.YT_STORE_FILE ||
  path.join(os.homedir(), ".clippilot", "youtube-accounts.json");

interface FileState {
  accounts: Record<string, YouTubeAccount>;
  active: string | null;
}

function readState(): FileState {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { accounts: s.accounts || {}, active: s.active ?? null };
  } catch {
    return { accounts: {}, active: null };
  }
}

function writeState(state: FileState): void {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2), "utf8");
  } catch {
    /* best-effort: a failed write just means this connection won't persist */
  }
}

// --- Backend selection (probe Redis once, then cache) ---
let backendPromise: Promise<"redis" | "file"> | null = null;

async function probeRedis(): Promise<boolean> {
  const url = process.env.REDIS_URL || "redis://localhost:6379/0";
  // Dedicated short-lived probe client so we fail fast and don't trigger reconnect storms
  // on the shared client when Redis is down.
  const probe = new Redis(url, {
    lazyConnect: true,
    connectTimeout: 800,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  // Swallow the connection 'error' event so a down Redis doesn't spam the console with
  // "Unhandled error event" (we handle the failure via the rejected connect() below).
  probe.on("error", () => {});
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}

async function backend(): Promise<"redis" | "file"> {
  if (!backendPromise) {
    backendPromise = (async () => {
      if ((process.env.YT_STORE || "").toLowerCase() === "file") return "file";
      return (await probeRedis()) ? "redis" : "file";
    })();
  }
  return backendPromise;
}

// Exposed so the UI / status route can tell the user where accounts are being stored.
export async function storeBackend(): Promise<"redis" | "file"> {
  return backend();
}

export async function listAccounts(): Promise<YouTubeAccount[]> {
  if ((await backend()) === "file") {
    return Object.values(readState().accounts);
  }
  const r = redis();
  const ids = await r.smembers(ACCOUNTS_SET);
  const out: YouTubeAccount[] = [];
  for (const id of ids) {
    const h = await r.hgetall(accountKey(id));
    if (h && Object.keys(h).length) out.push(h as unknown as YouTubeAccount);
  }
  return out;
}

export async function getActiveChannelId(): Promise<string | null> {
  if ((await backend()) === "file") return readState().active;
  return (await redis().get(ACTIVE_KEY)) || null;
}

export async function getAccount(id: string): Promise<YouTubeAccount | null> {
  if ((await backend()) === "file") return readState().accounts[id] || null;
  const h = await redis().hgetall(accountKey(id));
  return h && Object.keys(h).length ? (h as unknown as YouTubeAccount) : null;
}

export async function getActiveAccount(): Promise<YouTubeAccount | null> {
  const id = await getActiveChannelId();
  if (!id) return null;
  return getAccount(id);
}

export async function setActiveChannel(id: string): Promise<boolean> {
  if ((await backend()) === "file") {
    const s = readState();
    if (!s.accounts[id]) return false;
    s.active = id;
    writeState(s);
    return true;
  }
  const r = redis();
  if (!(await r.sismember(ACCOUNTS_SET, id))) return false;
  await r.set(ACTIVE_KEY, id);
  return true;
}

export async function saveAccount(acct: YouTubeAccount): Promise<void> {
  // Re-auth sometimes returns no refresh_token (Google only re-issues it on the first
  // consent). Never clobber a previously stored refresh_token with an empty one.
  if ((await backend()) === "file") {
    const s = readState();
    const rec: YouTubeAccount = { ...acct };
    if (!rec.refresh_token && s.accounts[acct.channel_id]?.refresh_token) {
      rec.refresh_token = s.accounts[acct.channel_id].refresh_token;
    }
    s.accounts[acct.channel_id] = rec;
    s.active = acct.channel_id; // newly connected account becomes the upload target
    writeState(s);
    return;
  }
  const r = redis();
  const key = accountKey(acct.channel_id);
  const record: YouTubeAccount = { ...acct };
  if (!record.refresh_token) {
    const existing = await r.hget(key, "refresh_token");
    if (existing) record.refresh_token = existing;
  }
  await r.hset(key, { ...record });
  await r.sadd(ACCOUNTS_SET, acct.channel_id);
  await r.set(ACTIVE_KEY, acct.channel_id);
}

// Merge a few fields onto an existing account (used to persist refreshed tokens).
export async function patchAccount(
  id: string,
  fields: Record<string, string>,
): Promise<void> {
  if (!Object.keys(fields).length) return;
  if ((await backend()) === "file") {
    const s = readState();
    if (!s.accounts[id]) return;
    s.accounts[id] = { ...s.accounts[id], ...fields } as YouTubeAccount;
    writeState(s);
    return;
  }
  await redis().hset(accountKey(id), fields);
}

export async function removeAccount(id: string): Promise<void> {
  if ((await backend()) === "file") {
    const s = readState();
    delete s.accounts[id];
    if (s.active === id) {
      const rest = Object.keys(s.accounts);
      s.active = rest[0] || null;
    }
    writeState(s);
    return;
  }
  const r = redis();
  await r.del(accountKey(id));
  await r.srem(ACCOUNTS_SET, id);
  if ((await r.get(ACTIVE_KEY)) === id) {
    const rest = await r.smembers(ACCOUNTS_SET);
    if (rest[0]) await r.set(ACTIVE_KEY, rest[0]);
    else await r.del(ACTIVE_KEY);
  }
}
