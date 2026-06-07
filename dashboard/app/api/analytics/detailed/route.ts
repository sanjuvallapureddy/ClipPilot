// Rich analytics for the dedicated /analytics page. Reads REAL clip results from Redis
// and derives aggregates (distributions, funnel, per-topic). Never fabricates metrics:
// views/likes/shares stay 0 until a clip is really posted. Resilient when Redis is down.
import { KEYS, redis, resultKey } from "@/lib/redis";
import { formatScore } from "@/lib/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ClipLite {
  clip_id: string;
  title: string;
  topic: string;
  hook: string;
  engagement: number;
  length: number;
  views: number;
  likes: number;
  shares: number;
  render_status: string;
  post_status: string;
  platform: string;
  posted_at: string;
  posted_ts: number;
}

function num(v: string | undefined, d = 0): number {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : d;
}

function empty(reason?: string) {
  return {
    generatedAt: Date.now(),
    degraded: Boolean(reason),
    reason,
    totals: {
      moments: 0,
      rendered: 0,
      posted: 0,
      notPosted: 0,
      views: 0,
      likes: 0,
      shares: 0,
      avgVirality: 0,
      topVirality: 0,
    },
    clips: [] as ClipLite[],
    byTopic: [] as {
      topic: string;
      clips: number;
      avgEngagement: number;
      views: number;
      posted: number;
    }[],
    scoreBuckets: [] as { bucket: string; count: number }[],
    lengthBuckets: [] as { bucket: string; count: number }[],
    funnel: [
      { stage: "Detected", count: 0 },
      { stage: "Rendered", count: 0 },
      { stage: "Posted", count: 0 },
    ],
    patterns: null as unknown,
  };
}

export async function GET() {
  try {
    const r = redis();
    const ids = await r.smembers(KEYS.RESULTS_SET);

    const clips: ClipLite[] = [];
    for (const id of ids) {
      const f = await r.hgetall(resultKey(id));
      if (!f || Object.keys(f).length === 0) continue;
      const postedAt = f.posted_at || "";
      const postedTs = postedAt ? Date.parse(postedAt) : 0;
      clips.push({
        clip_id: f.clip_id || id,
        title: f.title || "Untitled moment",
        topic: f.topic || "unknown",
        hook: f.hook || "",
        engagement: num(f.engagement_score),
        length: num(f.length_seconds),
        views: Math.round(num(f.views)),
        likes: Math.round(num(f.likes)),
        shares: Math.round(num(f.shares)),
        render_status: f.render_status || "pending",
        post_status: f.post_status || "not_posted",
        platform: f.platform || "",
        posted_at: postedAt,
        posted_ts: Number.isFinite(postedTs) ? postedTs : 0,
      });
    }

    const rendered = clips.filter((c) => c.render_status === "rendered").length;
    const posted = clips.filter((c) => c.post_status === "posted").length;
    const views = clips.reduce((a, c) => a + c.views, 0);
    const likes = clips.reduce((a, c) => a + c.likes, 0);
    const shares = clips.reduce((a, c) => a + c.shares, 0);
    const avgVirality =
      clips.length > 0
        ? formatScore(clips.reduce((a, c) => a + c.engagement, 0) / clips.length)
        : 0;
    const topVirality = formatScore(clips.reduce((m, c) => Math.max(m, c.engagement), 0));

    // Per-topic aggregation.
    const topicMap: Record<
      string,
      { eng: number[]; views: number; posted: number }
    > = {};
    for (const c of clips) {
      (topicMap[c.topic] ??= { eng: [], views: 0, posted: 0 }).eng.push(c.engagement);
      topicMap[c.topic].views += c.views;
      if (c.post_status === "posted") topicMap[c.topic].posted += 1;
    }
    const byTopic = Object.entries(topicMap)
      .map(([topic, v]) => ({
        topic,
        clips: v.eng.length,
        avgEngagement: formatScore(
          v.eng.reduce((a, b) => a + b, 0) / Math.max(v.eng.length, 1),
        ),
        views: v.views,
        posted: v.posted,
      }))
      .sort((a, b) => b.avgEngagement - a.avgEngagement);

    // Virality distribution (0–100 in 10-point buckets).
    const scoreBuckets = Array.from({ length: 10 }, (_, i) => ({
      bucket: `${i * 10}–${i * 10 + 9}`,
      count: 0,
    }));
    for (const c of clips) {
      const score = formatScore(c.engagement);
      const idx = Math.min(9, Math.max(0, Math.floor(score / 10)));
      scoreBuckets[idx].count += 1;
    }

    // Clip-length distribution (seconds).
    const lengthRanges = [
      { bucket: "0–15s", lo: 0, hi: 15 },
      { bucket: "15–30s", lo: 15, hi: 30 },
      { bucket: "30–45s", lo: 30, hi: 45 },
      { bucket: "45–60s", lo: 45, hi: 60 },
      { bucket: "60s+", lo: 60, hi: Infinity },
    ];
    const lengthBuckets = lengthRanges.map((r2) => ({
      bucket: r2.bucket,
      count: clips.filter((c) => c.length >= r2.lo && c.length < r2.hi).length,
    }));

    const funnel = [
      { stage: "Detected", count: clips.length },
      { stage: "Rendered", count: rendered },
      { stage: "Posted", count: posted },
    ];

    const patternsRaw = await r.get(KEYS.PATTERNS_CURRENT);
    const patterns = patternsRaw ? JSON.parse(patternsRaw) : null;

    return Response.json({
      generatedAt: Date.now(),
      degraded: false,
      totals: {
        moments: clips.length,
        rendered,
        posted,
        notPosted: clips.length - posted,
        views,
        likes,
        shares,
        avgVirality,
        topVirality,
      },
      clips,
      byTopic,
      scoreBuckets,
      lengthBuckets,
      funnel,
      patterns,
    });
  } catch (e) {
    return Response.json(empty(String((e as Error)?.message || e)));
  }
}
