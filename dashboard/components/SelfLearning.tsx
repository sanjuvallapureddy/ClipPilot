"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  GraduationCap,
  Trophy,
  TrendingDown,
  ArrowRight,
  Check,
  Lightbulb,
  Sparkles,
  Eye,
  Gauge,
} from "lucide-react";
import { Badge, SectionCard, Skeleton } from "@/components/ui";
import { formatScore } from "@/lib/format";
import type { LearningInsight } from "@/lib/types";

interface ClipBrief {
  clip_id: string;
  title: string;
  topic: string;
  hook: string;
  quote: string;
  length_seconds: number;
  views: number;
  engagement_score: number;
  post_status: string;
  source_url: string;
}

interface InsightsData {
  latest: LearningInsight | null;
  winner: ClipBrief | null;
  loser: ClipBrief | null;
  history: (LearningInsight & { stream_id: string })[];
}

function fmtSignal(value: number, signalSource: string) {
  return signalSource === "real_views"
    ? `${Math.round(value).toLocaleString()} views`
    : `${formatScore(value)} virality`;
}

function relativeTime(seconds: number) {
  if (!seconds) return "just now";
  const diff = Date.now() - seconds * 1000;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function ClipColumn({
  clip,
  insight,
  variant,
}: {
  clip: ClipBrief | null;
  insight: LearningInsight;
  variant: "winner" | "loser";
}) {
  const isWinner = variant === "winner";
  const signal = isWinner ? insight.winner_signal : insight.loser_signal;
  const tone = isWinner
    ? "border-emerald-900/50 bg-emerald-950/15"
    : "border-neutral-900 bg-neutral-950/30";
  return (
    <div className={`flex-1 rounded-lg border p-4 ${tone}`}>
      <div className="mb-2 flex items-center justify-between">
        <span
          className={`inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider ${
            isWinner ? "text-emerald-400" : "text-neutral-500"
          }`}
        >
          {isWinner ? <Trophy size={11} /> : <TrendingDown size={11} />}
          {isWinner ? "Winner" : "Underperformer"}
        </span>
        <span
          className={`inline-flex items-center gap-1 font-mono text-[11px] ${
            isWinner ? "text-emerald-300" : "text-neutral-400"
          }`}
        >
          {insight.signal_source === "real_views" ? (
            <Eye size={11} />
          ) : (
            <Gauge size={11} />
          )}
          {fmtSignal(signal, insight.signal_source)}
        </span>
      </div>
      <p className="line-clamp-2 text-xs font-medium leading-snug text-neutral-200">
        {clip?.hook || clip?.title || insight[isWinner ? "winner_clip_id" : "loser_clip_id"]}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {clip?.topic && <Badge>{clip.topic}</Badge>}
        {clip?.length_seconds ? <Badge>{Math.round(clip.length_seconds)}s</Badge> : null}
      </div>
    </div>
  );
}

export default function SelfLearning({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<InsightsData | null>(null);

  useEffect(() => {
    let on = true;
    const load = () =>
      fetch("/api/insights")
        .then((r) => r.json())
        .then((d) => on && setData(d))
        .catch(() => on && setData({ latest: null, winner: null, loser: null, history: [] }));
    load();
    const t = setInterval(load, 5000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [refreshKey]);

  const latest = data?.latest ?? null;

  return (
    <SectionCard
      title="Self-Learning Loop"
      icon={GraduationCap}
      right={
        latest ? (
          <div className="flex items-center gap-1.5 font-mono text-[10px] text-neutral-500">
            <Badge
              className={
                latest.signal_source === "real_views"
                  ? "border-emerald-900/60 text-emerald-300"
                  : "border-amber-900/50 text-amber-300/90"
              }
            >
              {latest.signal_source === "real_views"
                ? "real views"
                : "predicted virality"}
            </Badge>
            <span>{Math.round((latest.confidence || 0) * 100)}% conf</span>
          </div>
        ) : null
      }
    >
      {data === null && (
        <div className="space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <div className="flex gap-3">
            <Skeleton className="h-20 flex-1" />
            <Skeleton className="h-20 flex-1" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      )}

      {data !== null && !latest && (
        <div className="py-8 text-center">
          <Sparkles size={20} className="mx-auto mb-3 text-neutral-700" />
          <p className="mx-auto max-w-md font-mono text-xs leading-relaxed text-neutral-500">
            The self-learning loop compares the best-performing clip against the weakest,
            explains why it won, and auto-applies the lesson to the next batch. It runs
            every cycle once there are 2+ scored clips — no mock data, only the real
            signal (real views once posted, otherwise GPT predicted virality).
          </p>
        </div>
      )}

      {latest && (
        <div className="flex flex-col gap-4">
          {/* The explanation */}
          <p className="text-sm leading-relaxed text-neutral-200">{latest.why}</p>

          {/* Head-to-head */}
          <div className="flex items-stretch gap-2">
            <ClipColumn clip={data?.winner ?? null} insight={latest} variant="winner" />
            <div className="flex items-center text-neutral-700">
              <ArrowRight size={16} />
            </div>
            <ClipColumn clip={data?.loser ?? null} insight={latest} variant="loser" />
          </div>

          {/* Factors */}
          {latest.factors.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-neutral-500">
                What drove the win
              </div>
              <div className="flex flex-wrap gap-1.5">
                {latest.factors.map((f, i) => (
                  <Badge key={i} className="border-neutral-800 text-neutral-300">
                    {f}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {latest.recommendations.length > 0 && (
            <div>
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-neutral-500">
                <Lightbulb size={11} className="text-amber-400/80" />
                Recommendations
              </div>
              <ul className="flex flex-col gap-1.5">
                {latest.recommendations.map((rec, i) => (
                  <li
                    key={i}
                    className="flex gap-2 text-xs leading-relaxed text-neutral-400"
                  >
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500/70" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Auto-applied — the AI implementing it itself */}
          {latest.applied.length > 0 && (
            <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/15 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-emerald-400/90">
                <Check size={11} />
                Auto-applied to the next batch
              </div>
              <ul className="flex flex-col gap-1">
                {latest.applied.map((a, i) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="flex items-center gap-2 font-mono text-[11px] text-emerald-200/90"
                  >
                    <Check size={11} className="shrink-0 text-emerald-400" />
                    {a}
                  </motion.li>
                ))}
              </ul>
            </div>
          )}

          {/* History */}
          {data && data.history.length > 1 && (
            <div className="border-t border-neutral-900 pt-3">
              <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-neutral-500">
                Learning history
              </div>
              <div className="flex flex-col gap-1.5">
                {data.history.slice(1, 6).map((h) => (
                  <div
                    key={h.stream_id}
                    className="flex items-center justify-between gap-3 text-[11px]"
                  >
                    <span className="truncate text-neutral-500">{h.why}</span>
                    <span className="shrink-0 font-mono text-neutral-600">
                      {h.applied.length} applied · {relativeTime(h.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
