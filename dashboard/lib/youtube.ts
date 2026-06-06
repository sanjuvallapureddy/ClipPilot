// Server-only YouTube OAuth + token store (Lane D add-on).
// Direct upload to YouTube via the official Google client. Multiple Google accounts can
// be connected; the "active" one is the upload target and can be switched from the UI.
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

// OAuth client config comes from env (loaded from the project .env). The Google Cloud
// "Web application" client must list the redirect URI below exactly.
export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
export const GOOGLE_REDIRECT_URI =
  process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/oauth2callback";

// Upload scope + read scope (channel title for display) + identity (email for display).
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
];

export function youtubeConfigured(): boolean {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
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
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
  );
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
  await r.hset(accountKey(acct.channel_id), { ...acct });
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

// Build an authorized client for the active account, persisting any refreshed token.
export async function authedClientForActive(): Promise<{
  client: OAuth2Client;
  account: YouTubeAccount;
} | null> {
  const account = await getActiveAccount();
  if (!account) return null;
  const client = newOAuthClient();
  client.setCredentials({
    refresh_token: account.refresh_token,
    access_token: account.access_token || undefined,
    expiry_date: account.expiry_date ? Number(account.expiry_date) : undefined,
  });
  client.on("tokens", (tokens: TokenSet) => {
    // Persist refreshed access tokens so we don't re-auth every hour.
    const patch: Record<string, string> = {};
    if (tokens.access_token) patch.access_token = tokens.access_token;
    if (tokens.expiry_date) patch.expiry_date = String(tokens.expiry_date);
    if (tokens.refresh_token) patch.refresh_token = tokens.refresh_token;
    if (Object.keys(patch).length) {
      redis().hset(accountKey(account.channel_id), patch).catch(() => {});
    }
  });
  return { client, account };
}
