// Discovered queue: latest items from discovery:queue.
import { fieldsToObj, KEYS, redis } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const r = redis();
  let entries: [string, string[]][] = [];
  try {
    entries = (await r.xrevrange(KEYS.DISCOVERY_QUEUE, "+", "-", "COUNT", 30)) as [
      string,
      string[],
    ][];
  } catch {
    /* empty */
  }
  const items = entries.map(([id, fields]) => {
    const o = fieldsToObj(fields);
    return {
      id,
      youtube_url: o.youtube_url,
      title: o.title,
      podcast: o.podcast,
      topic: o.topic,
      trend_score: parseFloat(o.trend_score || "0"),
      source: o.source,
    };
  });
  return Response.json({ items });
}
