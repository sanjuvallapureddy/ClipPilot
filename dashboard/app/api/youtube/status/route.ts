// Connected YouTube accounts + which one is the active upload target.
import {
  youtubeConfigured,
  listAccounts,
  getActiveChannelId,
  storeBackend,
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
      store: await storeBackend(),
    });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    const redisUnavailable =
      /MaxRetriesPerRequestError|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|Connection is closed/i.test(
        msg,
      );
    return Response.json(
      {
        configured: true,
        connected: false,
        accounts: [],
        error: msg,
        reason: redisUnavailable ? "redis_unavailable" : "unknown",
      },
      { status: redisUnavailable ? 503 : 502 },
    );
  }
}
