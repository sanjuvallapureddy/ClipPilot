// Analytics: engagement over time + current winning patterns.
import { KEYS, redis, resultKey } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const r = redis();
  const ids = await r.smembers(KEYS.RESULTS_SET);

  const points: { posted_at: string; engagement: number; views: number; topic: string }[] =
    [];
  const byTopic: Record<string, { eng: number[]; views: number }> = {};
  const byPlatform: Record<string, { views: number; clips: number }> = {};

  for (const id of ids) {
    const f = await r.hgetall(resultKey(id));
    if (!f || !f.posted_at) continue;
    const eng = parseFloat(f.engagement_score || "0");
    const views = parseInt(f.views || "0", 10);
    const topic = f.topic || "unknown";
    const platform = f.platform || "unknown";
    points.push({ posted_at: f.posted_at, engagement: eng, views, topic });
    (byTopic[topic] ??= { eng: [], views: 0 }).eng.push(eng);
    byTopic[topic].views += views;
    (byPlatform[platform] ??= { views: 0, clips: 0 }).views += views;
    byPlatform[platform].clips += 1;
  }

  points.sort((a, b) => a.posted_at.localeCompare(b.posted_at));

  const topicStats = Object.entries(byTopic)
    .map(([topic, v]) => ({
      topic,
      avg_engagement: v.eng.reduce((a, b) => a + b, 0) / Math.max(v.eng.length, 1),
      views: v.views,
      clips: v.eng.length,
    }))
    .sort((a, b) => b.avg_engagement - a.avg_engagement);

  const patternsRaw = await r.get(KEYS.PATTERNS_CURRENT);
  const patterns = patternsRaw ? JSON.parse(patternsRaw) : null;

  return Response.json({
    timeline: points,
    topicStats,
    platformStats: Object.entries(byPlatform).map(([platform, v]) => ({
      platform,
      ...v,
    })),
    patterns,
    totals: {
      clips: ids.length,
      views: points.reduce((a, p) => a + p.views, 0),
    },
  });
}
