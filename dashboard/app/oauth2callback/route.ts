// Google OAuth redirect target (must match the Cloud Console redirect URI exactly:
// http://localhost:3000/oauth2callback). Exchanges the code for tokens, identifies the
// YouTube channel, stores it, and returns to the dashboard.
import { google } from "googleapis";
import { cookies } from "next/headers";
import { newOAuthClient, saveAccount, type YouTubeAccount } from "@/lib/youtube";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function back(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  return Response.redirect(
    `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/?${qs}`,
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const err = url.searchParams.get("error");
  if (err) return back({ youtube: "error", reason: err });
  if (!code) return back({ youtube: "error", reason: "missing_code" });

  // CSRF check.
  const expected = cookies().get("yt_oauth_state")?.value;
  cookies().delete("yt_oauth_state");
  if (!expected || expected !== state) {
    return back({ youtube: "error", reason: "state_mismatch" });
  }

  try {
    const oauth = newOAuthClient();
    const { tokens } = await oauth.getToken(code);
    oauth.setCredentials(tokens);

    // Identify the channel (display) + email.
    const yt = google.youtube({ version: "v3", auth: oauth });
    const ch = await yt.channels.list({ part: ["snippet"], mine: true });
    const channel = ch.data.items?.[0];
    let email = "";
    try {
      const oauth2 = google.oauth2({ version: "v2", auth: oauth });
      const info = await oauth2.userinfo.get();
      email = info.data.email || "";
    } catch {
      /* userinfo optional */
    }

    if (!channel?.id) {
      return back({ youtube: "error", reason: "no_youtube_channel" });
    }

    const account: YouTubeAccount = {
      channel_id: channel.id,
      channel_title: channel.snippet?.title || "YouTube channel",
      thumbnail: channel.snippet?.thumbnails?.default?.url || "",
      email,
      refresh_token: tokens.refresh_token || "",
      access_token: tokens.access_token || "",
      expiry_date: tokens.expiry_date ? String(tokens.expiry_date) : "",
      connected_at: new Date().toISOString(),
    };
    await saveAccount(account);
    return back({ youtube: "connected", channel: account.channel_title });
  } catch (e) {
    return back({ youtube: "error", reason: String(e).slice(0, 120) });
  }
}
