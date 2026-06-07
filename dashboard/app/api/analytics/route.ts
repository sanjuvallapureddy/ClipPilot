// Analytics: engagement over time + current winning patterns.
import { KEYS, redis, resultKey } from "@/lib/redis";
import { formatScore } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function emptyPayload(reason?: string) {
  return {
    timeline: [] as { engagement: number; views: number }[],
    topicStats: [] as {
      topic: string;
      avg_engagement: number;
      views: number;
      clips: number;
    }[],
    patterns: null,
    totals: { moments: 0, posted: 0, views: 0, avg_virality: 0 },
    degraded: Boolean(reason),
    reason,
  };
}

export async function GET() {
  try {
    const r = redis();
    const ids = await r.smembers(KEYS.RESULTS_SET);

    const points: { engagement: number; views: number; topic: string }[] = [];
    const byTopic: Record<string, { eng: number[]; views: number }> = {};
    let posted = 0;
    let totalViews = 0;

    for (const id of ids) {
      const f = await r.hgetall(resultKey(id));
      if (!f || Object.keys(f).length === 0) continue;
      const eng = parseFloat(f.engagement_score || "0");
      const views = parseInt(f.views || "0", 10);
      const topic = f.topic || "unknown";
      if (f.post_status === "posted") posted += 1;
      totalViews += views;
      points.push({ engagement: eng, views, topic });
      (byTopic[topic] ??= { eng: [], views: 0 }).eng.push(eng);
      byTopic[topic].views += views;
    }

    // chart by descending predicted virality (real GPT scores) until real metrics exist
    points.sort((a, b) => b.engagement - a.engagement);

    const topicStats = Object.entries(byTopic)
      .map(([topic, v]) => ({
        topic,
        avg_engagement: formatScore(
          v.eng.reduce((a, b) => a + b, 0) / Math.max(v.eng.length, 1),
        ),
        views: v.views,
        clips: v.eng.length,
      }))
      .sort((a, b) => b.avg_engagement - a.avg_engagement);

    const patternsRaw = await r.get(KEYS.PATTERNS_CURRENT);
    const patterns = patternsRaw ? JSON.parse(patternsRaw) : null;

    const avgVirality =
      points.length > 0
        ? formatScore(points.reduce((a, p) => a + p.engagement, 0) / points.length)
        : 0;

    return Response.json({
      timeline: points.map((p) => ({
        engagement: formatScore(p.engagement),
        views: p.views,
      })),
      topicStats,
      patterns,
      totals: {
        moments: ids.length,
        posted,
        views: totalViews,
        avg_virality: avgVirality,
      },
      degraded: false,
    });
  } catch (e) {
    // Redis / orchestrator offline — return a clean empty payload (HTTP 200) so the UI
    // shows an honest "no data yet" state instead of getting stuck loading on a 500.
    const msg = String((e as Error)?.message || e);
    return Response.json(emptyPayload(msg));
  }
}
