// SSE route: push each job's current state first, then tail `jobs:stream`.
import { blockingRedis, fieldsToObj, jobKey, KEYS } from "@/lib/redis";

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

      // Backfill current job hashes, not raw historical events. A reconnect should never
      // resurrect stale rows like fetching/analyzing after a job has already failed.
      try {
        const latestByJob = new Map<string, Record<string, string>>();
        const recent = (await sub.xrevrange(KEYS.JOBS_STREAM, "+", "-", "COUNT", 100)) as [
          string,
          string[],
        ][];
        for (const [, fields] of recent) {
          const ev = fieldsToObj(fields);
          if (ev.job_id && !latestByJob.has(ev.job_id)) {
            latestByJob.set(ev.job_id, ev);
          }
          if (latestByJob.size >= 25) break;
        }
        for (const [id, streamEv] of [...latestByJob.entries()].reverse()) {
          const job = await sub.hgetall(jobKey(id));
          if (job?.job_id) {
            send("job", {
              job_id: job.job_id,
              stage: job.stage,
              status: job.status,
              title: job.title,
              message:
                job.error ||
                streamEv.message ||
                `current stage: ${job.stage}`,
              ts: Number(job.updated_at || streamEv.ts || 0),
            });
          }
        }
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
