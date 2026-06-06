// Kick off the YouTube OAuth flow. Redirects the browser to Google's consent screen
// (with account chooser, so the user can connect or switch accounts client-side).
import { randomBytes } from "crypto";
import { cookies } from "next/headers";
import { consentUrl, youtubeConfigured } from "@/lib/youtube";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!youtubeConfigured()) {
    return Response.json(
      { error: "YouTube OAuth not configured (set GOOGLE_CLIENT_ID/SECRET)." },
      { status: 503 },
    );
  }
  // CSRF: random state echoed back to /oauth2callback and matched against this cookie.
  const state = randomBytes(16).toString("hex");
  cookies().set("yt_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return Response.redirect(consentUrl(state));
}
