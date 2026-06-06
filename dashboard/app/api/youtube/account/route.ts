// Switch the active upload account, or disconnect an account — both client-driven so the
// user can change which Google/YouTube account clips publish to, from the browser.
import { setActiveChannel, removeAccount } from "@/lib/youtube";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = body.action as string;
  const channelId = body.channel_id as string;
  if (!channelId) {
    return Response.json({ error: "channel_id required" }, { status: 400 });
  }
  try {
    if (action === "activate") {
      const ok = await setActiveChannel(channelId);
      if (!ok) return Response.json({ error: "unknown channel" }, { status: 404 });
      return Response.json({ ok: true, active_channel_id: channelId });
    }
    if (action === "disconnect") {
      await removeAccount(channelId);
      return Response.json({ ok: true });
    }
    return Response.json({ error: `unknown action ${action}` }, { status: 400 });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 502 });
  }
}
