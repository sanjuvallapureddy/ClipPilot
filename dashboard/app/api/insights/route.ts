// Self-learning insights: the latest "why the winner beat the loser" comparison
// (insights:latest) plus the audit history (insights:stream), enriched with the two
// clips being compared. Written by Lane B's performance/insights.py.
import { fieldsToObj, KEYS, redis, resultKey } from "@/lib/redis";
import type Redis from "ioredis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Stream entries store list fields as JSON strings (shared _flatten); latest is full JSON.
function parseList(v: string | undefined): string[] {
  if (!v) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [v];
  }
}

function parseInsightFields(f: Record<string, string>) {
  return {
    insight_id: f.insight_id || "",
    winner_clip_id: f.winner_clip_id || "",
    loser_clip_id: f.loser_clip_id || "",
    signal_source: f.signal_source || "predicted_virality",
    winner_signal: parseFloat(f.winner_signal || "0"),
    loser_signal: parseFloat(f.loser_signal || "0"),
    why: f.why || "",
    factors: parseList(f.factors),
    recommendations: parseList(f.recommendations),
    applied: parseList(f.applied),
    confidence: parseFloat(f.confidence || "0"),
    created_at: parseFloat(f.created_at || "0"),
  };
}

async function clipBrief(r: Redis, id: string | undefined) {
  if (!id) return null;
  const f = await r.hgetall(resultKey(id));
  if (!f || Object.keys(f).length === 0) return null;
  return {
    clip_id: id,
    title: f.title || "",
    topic: f.topic || "",
    hook: f.hook || "",
    quote: f.quote || "",
    length_seconds: parseFloat(f.length_seconds || "0"),
    views: parseInt(f.views || "0", 10),
    engagement_score: parseFloat(f.engagement_score || "0"),
    post_status: f.post_status || "not_posted",
    source_url: f.source_url || "",
  };
}

export async function GET() {
  const r = redis();

  let latest: ReturnType<typeof parseInsightFields> | null = null;
  const rawLatest = await r.get(KEYS.INSIGHTS_LATEST);
  if (rawLatest) {
    try {
      latest = parseInsightFields(JSON.parse(rawLatest));
    } catch {
      latest = null;
    }
  }

  let history: (ReturnType<typeof parseInsightFields> & { stream_id: string })[] = [];
  try {
    const entries = (await r.xrevrange(
      KEYS.INSIGHTS_STREAM,
      "+",
      "-",
      "COUNT",
      12,
    )) as [string, string[]][];
    history = entries.map(([id, fields]) => ({
      ...parseInsightFields(fieldsToObj(fields)),
      stream_id: id,
    }));
  } catch {
    /* stream may not exist yet */
  }

  if (!latest && history.length > 0) latest = history[0];

  const winner = latest ? await clipBrief(r, latest.winner_clip_id) : null;
  const loser = latest ? await clipBrief(r, latest.loser_clip_id) : null;

  return Response.json({ latest, winner, loser, history });
}
