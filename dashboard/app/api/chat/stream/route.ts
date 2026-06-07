// SSE route: tail `chat:stream` and push every team-chat message to the dashboard.
// Mirrors app/api/jobs/stream/route.ts. Channels and DMs share one stream; the client
// splits them by `channel`.
import { blockingRedis, fieldsToObj, KEYS } from "@/lib/redis";
import type { ChatMessage } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toChat(id: string, fields: string[]): ChatMessage {
  const o = fieldsToObj(fields);
  let mentions: string[] = [];
  try {
    mentions = o.mentions ? (JSON.parse(o.mentions) as string[]) : [];
  } catch {
    mentions = o.mentions ? o.mentions.split(",").filter(Boolean) : [];
  }
  return {
    id,
    author: o.author || "",
    channel: o.channel || "general",
    text: o.text || "",
    mentions,
    in_reply_to: o.in_reply_to || "",
    kind: o.kind || "chat",
    ts: Number(o.ts) || 0,
  };
}

export async function GET() {
  const encoder = new TextEncoder();
  const sub = blockingRedis();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );

      // Backfill recent history so the workspace isn't empty on connect.
      try {
        const recent = (await sub.xrevrange(
          KEYS.CHAT_STREAM,
          "+",
          "-",
          "COUNT",
          100,
        )) as [string, string[]][];
        for (const [id, fields] of recent.reverse()) send("chat", toChat(id, fields));
      } catch {
        /* stream may not exist yet */
      }

      let lastId = "$"; // only new messages from here
      let closed = false;
      const keepAlive = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
      }, 15000);

      try {
        while (!closed) {
          const res = (await sub.xread(
            "BLOCK",
            5000,
            "STREAMS",
            KEYS.CHAT_STREAM,
            lastId,
          )) as [string, [string, string[]][]][] | null;
          if (!res) continue;
          for (const [, entries] of res) {
            for (const [id, fields] of entries) {
              lastId = id;
              send("chat", toChat(id, fields));
            }
          }
        }
      } catch {
        /* client disconnected */
      } finally {
        closed = true;
        clearInterval(keepAlive);
        sub.disconnect();
      }
    },
    cancel() {
      sub.disconnect();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
