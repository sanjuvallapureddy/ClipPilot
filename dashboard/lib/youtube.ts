// Server-only YouTube OAuth + token store (Lane D add-on).
// Direct upload to YouTube via the official Google client. Multiple Google accounts can
// be connected; the "active" one is the upload target and can be switched from the UI.
import fs from "fs";
import path from "path";
import { google } from "googleapis";
import { redis } from "@/lib/redis";

// Use the OAuth2 client type that ships with the googleapis bundle so it matches the
// `auth` parameter google.youtube()/google.oauth2() expect (avoids duplicate-package
// type clashes with a hoisted google-auth-library).
export type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
type TokenSet = {
  access_token?: string | null;
  refresh_token?: string | null;
  expiry_date?: number | null;
};

interface ClientConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// Credentials come from env first (project .env), then a gitignored client_secret.json
// (the file Google Cloud hands you). Secrets stay server-side only — never sent to the
// browser. The Web-application OAuth client must list the redirect URI exactly.
function loadClientConfig(): ClientConfig {
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/oauth2callback";

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri,
    };
  }

  // Fallback: read client_secret.json from the dashboard dir or the repo root.
  const candidates = [
    process.env.GOOGLE_CLIENT_SECRET_FILE,
    path.join(process.cwd(), "client_secret.json"),
    path.join(process.cwd(), "..", "client_secret.json"),
  ].filter(Boolean) as string[];

  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      const node = parsed.web || parsed.installed || {};
      if (node.client_id && node.client_secret) {
        return {
          clientId: node.client_id,
          clientSecret: node.client_secret,
          redirectUri:
            (Array.isArray(node.redirect_uris) && node.redirect_uris[0]) ||
            redirectUri,
        };
      }
    } catch {
      /* try next candidate */
    }
  }
  return { clientId: "", clientSecret: "", redirectUri };
}

export const GOOGLE_REDIRECT_URI = loadClientConfig().redirectUri;

// Upload scope + read scope (channel title for display) + identity (email for display).
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
];

export function youtubeConfigured(): boolean {
  const c = loadClientConfig();
  return Boolean(c.clientId && c.clientSecret);
}

// --- Redis key contract for connected accounts ---
const ACTIVE_KEY = "youtube:active"; // string: channel_id of the active account
const ACCOUNTS_SET = "youtube:accounts"; // set of channel_ids
const accountKey = (channelId: string) => `youtube:account:${channelId}`;

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

export function newOAuthClient(): OAuth2Client {
  const c = loadClientConfig();
  return new google.auth.OAuth2(c.clientId, c.clientSecret, c.redirectUri);
}

// Consent URL. prompt "select_account consent" lets the user pick / switch the Google
// account from the browser and guarantees a refresh_token even on re-auth.
export function consentUrl(state: string): string {
  return newOAuthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "select_account consent",
    scope: YOUTUBE_SCOPES,
    include_granted_scopes: true,
    state,
  });
}

export async function listAccounts(): Promise<YouTubeAccount[]> {
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
  return (await redis().get(ACTIVE_KEY)) || null;
}

export async function getActiveAccount(): Promise<YouTubeAccount | null> {
  const id = await getActiveChannelId();
  if (!id) return null;
  const h = await redis().hgetall(accountKey(id));
  return h && Object.keys(h).length ? (h as unknown as YouTubeAccount) : null;
}

export async function setActiveChannel(channelId: string): Promise<boolean> {
  const r = redis();
  if (!(await r.sismember(ACCOUNTS_SET, channelId))) return false;
  await r.set(ACTIVE_KEY, channelId);
  return true;
}

export async function saveAccount(acct: YouTubeAccount): Promise<void> {
  const r = redis();
  const key = accountKey(acct.channel_id);
  // Re-auth sometimes returns no refresh_token (Google only re-issues it on the first
  // consent). Never clobber a previously stored refresh_token with an empty one, or we'd
  // permanently lose the ability to refresh access tokens for this account.
  const record: YouTubeAccount = { ...acct };
  if (!record.refresh_token) {
    const existing = await r.hget(key, "refresh_token");
    if (existing) record.refresh_token = existing;
  }
  await r.hset(key, { ...record });
  await r.sadd(ACCOUNTS_SET, acct.channel_id);
  // Newly connected / re-authed account becomes the active upload target.
  await r.set(ACTIVE_KEY, acct.channel_id);
}

export async function removeAccount(channelId: string): Promise<void> {
  const r = redis();
  await r.del(accountKey(channelId));
  await r.srem(ACCOUNTS_SET, channelId);
  if ((await r.get(ACTIVE_KEY)) === channelId) {
    const rest = await r.smembers(ACCOUNTS_SET);
    if (rest[0]) await r.set(ACTIVE_KEY, rest[0]);
    else await r.del(ACTIVE_KEY);
  }
}

// Build an authorized client for a specific connected account, auto-persisting any
// refreshed token. Throws if the account exists but has no refresh_token (needs re-auth).
export async function authedClientFor(channelId: string): Promise<{
  client: OAuth2Client;
  account: YouTubeAccount;
} | null> {
  const h = await redis().hgetall(accountKey(channelId));
  if (!h || !Object.keys(h).length) return null;
  const account = h as unknown as YouTubeAccount;

  const client = newOAuthClient();
  client.setCredentials({
    refresh_token: account.refresh_token || undefined,
    access_token: account.access_token || undefined,
    expiry_date: account.expiry_date ? Number(account.expiry_date) : undefined,
  });
  // The google-auth client emits "tokens" whenever it mints a new access token (or a new
  // refresh token). Persist them so we keep working across restarts without re-consent.
  client.on("tokens", (tokens: TokenSet) => {
    const patch: Record<string, string> = {};
    if (tokens.access_token) patch.access_token = tokens.access_token;
    if (tokens.expiry_date) patch.expiry_date = String(tokens.expiry_date);
    if (tokens.refresh_token) patch.refresh_token = tokens.refresh_token;
    if (Object.keys(patch).length) {
      redis().hset(accountKey(account.channel_id), patch).catch(() => {});
    }
  });

  // Proactively refresh if the access token is missing or expires within 60s. The client
  // also refreshes lazily on each request, but doing it up-front surfaces a dead/revoked
  // refresh_token as a clear error instead of mid-upload.
  const expiresAt = account.expiry_date ? Number(account.expiry_date) : 0;
  const needsRefresh = !account.access_token || expiresAt - Date.now() < 60_000;
  if (needsRefresh) {
    if (!account.refresh_token) {
      throw new Error("reauth_required");
    }
    try {
      await client.getAccessToken(); // triggers refresh + "tokens" event above
    } catch {
      throw new Error("reauth_required");
    }
  }
  return { client, account };
}

// Convenience: authorized client for whichever account is the active upload target.
export async function authedClientForActive(): Promise<{
  client: OAuth2Client;
  account: YouTubeAccount;
} | null> {
  const id = await getActiveChannelId();
  if (!id) return null;
  return authedClientFor(id);
}
