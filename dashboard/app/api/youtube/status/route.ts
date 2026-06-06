// Connected YouTube accounts + which one is the active upload target.
import {
  youtubeConfigured,
  listAccounts,
  getActiveChannelId,
} from "@/lib/youtube";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!youtubeConfigured()) {
    return Response.json({
      configured: false,
      connected: false,
      accounts: [],
      active_channel_id: null,
    });
  }
  try {
    const accounts = await listAccounts();
    const active = await getActiveChannelId();
    // Never leak tokens to the client — expose display fields only.
    const safe = accounts.map((a) => ({
      channel_id: a.channel_id,
      channel_title: a.channel_title,
      thumbnail: a.thumbnail,
      email: a.email,
      connected_at: a.connected_at,
      active: a.channel_id === active,
    }));
    return Response.json({
      configured: true,
      connected: safe.length > 0,
      accounts: safe,
      active_channel_id: active,
    });
  } catch (e) {
    return Response.json(
      { configured: true, connected: false, accounts: [], error: String(e) },
      { status: 502 },
    );
  }
}
