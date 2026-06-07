"use client";
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { motion } from "framer-motion";
import { BarChart3, Sparkles, Trophy, Send, Activity } from "lucide-react";
import type { Patterns } from "@/lib/types";
import { SectionCard, MetricCard, Badge, Skeleton, AnimatedNumber } from "@/components/ui";
import { formatScore } from "@/lib/format";

interface AnalyticsData {
  timeline: { engagement: number; views: number }[];
  topicStats: { topic: string; avg_engagement: number; views: number; clips: number }[];
  patterns: Patterns | null;
  totals: { moments: number; posted: number; views: number; avg_virality: number };
  degraded?: boolean;
}

export default function Analytics({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    let on = true;
    const load = () =>
      fetch("/api/analytics")
        .then((r) => r.json())
        .then((d) => on && setData(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [refreshKey]);

  if (!data)
    return (
      <SectionCard title="Analytics · Predicted Virality & Winning Patterns" icon={BarChart3}>
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-neutral-900 p-4">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-6 w-12" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-4 h-40 w-full" />
      </SectionCard>
    );

  const series = data.timeline.map((p, i) => ({
    i,
    engagement: formatScore(p.engagement),
    views: p.views,
  }));

  return (
    <SectionCard title="Analytics · Predicted Virality & Winning Patterns" icon={BarChart3}>
      <div className="grid grid-cols-3 gap-3">
        <MetricCard
          title="Moments"
          icon={Sparkles}
          value={<AnimatedNumber value={data.totals.moments} />}
          description="detected"
        />
        <MetricCard
          title="Avg Virality"
          icon={Activity}
          value={formatScore(data.totals.avg_virality || 0)}
          description="predicted"
        />
        <MetricCard
          title="Posted"
          icon={Send}
          value={<AnimatedNumber value={data.totals.posted} />}
          description="live"
        />
      </div>

      <p className="mt-4 text-xs leading-relaxed text-neutral-500">
        Scores are GPT-predicted virality from the real transcript. Real views and likes
        appear once clips are rendered (OpenShorts) and posted (platform credentials).
      </p>

      <div className="mt-4 h-40">
        {series.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="engagementFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f5f5f5" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="#f5f5f5" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="i" hide />
              <YAxis hide />
              <Tooltip
                cursor={{ stroke: "#262626", strokeWidth: 1 }}
                contentStyle={{
                  background: "#0a0a0a",
                  border: "1px solid #262626",
                  borderRadius: 8,
                  fontSize: 11,
                }}
                labelStyle={{ color: "#737373" }}
                itemStyle={{ color: "#f5f5f5" }}
              />
              <Area
                type="monotone"
                dataKey="engagement"
                stroke="#f5f5f5"
                fill="url(#engagementFill)"
                strokeWidth={1.5}
                isAnimationActive
                animationDuration={1100}
                animationEasing="ease-out"
                activeDot={{ r: 3, fill: "#f5f5f5", stroke: "#000", strokeWidth: 1 }}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-800 bg-neutral-950/40 text-center">
            <span className="text-xs text-neutral-400">
              {data.degraded ? "Waiting for the orchestrator" : "No moments yet"}
            </span>
            <span className="text-[11px] text-neutral-600">
              {data.degraded
                ? "Start Redis + Lane A, then run the pipeline."
                : "Run the pipeline to detect real viral moments."}
            </span>
          </div>
        )}
      </div>

      <h3 className="mb-3 mt-5 text-xs font-medium uppercase tracking-wider text-neutral-500">
        Top Topics
      </h3>
      <div className="flex flex-col gap-2.5">
        {data.topicStats.slice(0, 5).map((t, i) => (
          <motion.div
            key={t.topic}
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: "-20px" }}
            transition={{ duration: 0.4, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-neutral-300">{t.topic}</span>
              <span className="font-mono tabular-nums text-emerald-400">
                {formatScore(t.avg_engagement)}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-neutral-900">
              <motion.span
                className="block h-full rounded-full bg-neutral-100"
                initial={{ width: 0 }}
                whileInView={{ width: `${Math.min(100, formatScore(t.avg_engagement))}%` }}
                viewport={{ once: true, margin: "-20px" }}
                transition={{ duration: 0.9, delay: i * 0.05 + 0.1, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          </motion.div>
        ))}
      </div>

      {data.patterns && (
        <div className="mt-5 border-t border-neutral-900 pt-4">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-neutral-500">
            Learned Patterns (Lane B → Lane A)
          </h3>
          <p className="mb-3 text-xs text-neutral-400">{data.patterns.summary}</p>
          <div className="flex flex-wrap gap-1.5">
            {data.patterns.winning_topics?.map((t) => (
              <Badge key={t}>
                <Trophy size={10} className="text-neutral-500" />
                {t}
              </Badge>
            ))}
          </div>
          <p className="mt-3 font-mono text-[10px] text-neutral-600">
            ideal length {data.patterns.ideal_length_min}–{data.patterns.ideal_length_max}s ·
            caption: {data.patterns.caption_style}
          </p>
        </div>
      )}
    </SectionCard>
  );
}
