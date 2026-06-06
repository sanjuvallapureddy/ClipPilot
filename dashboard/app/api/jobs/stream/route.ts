// SSE route: tail `jobs:stream` and push every job-status change to the dashboard.
import { blockingRedis, fieldsToObj, KEYS } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const encoder = new TextEncoder();
  const sub = blockingRedis();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );

      // Backfill recent events so the panel isn't empty on connect.
      try {
        const recent = (await sub.xrevrange(KEYS.JOBS_STREAM, "+", "-", "COUNT", 25)) as [
          string,
          string[],
        ][];
        for (const [, fields] of recent.reverse()) send("job", fieldsToObj(fields));
      } catch {
        /* stream may not exist yet */
      }

      let lastId = "$"; // only new events from here
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
            KEYS.JOBS_STREAM,
            lastId,
          )) as [string, [string, string[]][]][] | null;
          if (!res) continue;
          for (const [, entries] of res) {
            for (const [id, fields] of entries) {
              lastId = id;
              send("job", fieldsToObj(fields));
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
