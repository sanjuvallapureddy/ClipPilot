// Clips gallery: every results:{clip_id} with per-platform post status.
import { KEYS, redis, resultKey } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const r = redis();
  const ids = await r.smembers(KEYS.RESULTS_SET);
  const clips = [];
  for (const id of ids) {
    const fields = await r.hgetall(resultKey(id));
    if (!fields || Object.keys(fields).length === 0) continue;
    clips.push({
      clip_id: id,
      job_id: fields.job_id,
      clip_url: fields.clip_url,
      platform: fields.platform,
      post_id: fields.post_id,
      posted_at: fields.posted_at,
      title: fields.title,
      topic: fields.topic,
      hook: fields.hook,
      length_seconds: parseFloat(fields.length_seconds || "0"),
      views: parseInt(fields.views || "0", 10),
      likes: parseInt(fields.likes || "0", 10),
      shares: parseInt(fields.shares || "0", 10),
      engagement_score: parseFloat(fields.engagement_score || "0"),
    });
  }
  clips.sort((a, b) => b.engagement_score - a.engagement_score);
  return Response.json({ clips });
}
