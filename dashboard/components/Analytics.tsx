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
import { BarChart3, Sparkles, Trophy, Send, Activity } from "lucide-react";
import type { Patterns } from "@/lib/types";
import { SectionCard, MetricCard, Badge } from "@/components/ui";

interface AnalyticsData {
  timeline: { engagement: number; views: number }[];
  topicStats: { topic: string; avg_engagement: number; views: number; clips: number }[];
  patterns: Patterns | null;
  totals: { moments: number; posted: number; views: number; avg_virality: number };
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
      <SectionCard title="Analytics" icon={BarChart3}>
        <div className="py-6 text-center font-mono text-xs text-neutral-600">Loading…</div>
      </SectionCard>
    );

  const series = data.timeline.map((p, i) => ({
    i,
    engagement: +p.engagement.toFixed(3),
    views: p.views,
  }));

  return (
    <SectionCard title="Analytics · Predicted Virality & Winning Patterns" icon={BarChart3}>
      <div className="grid grid-cols-3 gap-3">
        <MetricCard title="Moments" icon={Sparkles} value={data.totals.moments} description="detected" />
        <MetricCard
          title="Avg Virality"
          icon={Activity}
          value={(data.totals.avg_virality || 0).toFixed(2)}
          description="predicted"
        />
        <MetricCard title="Posted" icon={Send} value={data.totals.posted} description="live" />
      </div>

      <p className="mt-4 font-mono text-[10px] leading-relaxed text-neutral-600">
        Scores are GPT predicted virality from the real transcript. Real views/likes appear
        once clips are rendered (OpenShorts) and posted (platform credentials).
      </p>

      <div className="mt-4 h-40">
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
                fontFamily: "ui-monospace, monospace",
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
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <h3 className="mb-3 mt-5 text-xs font-medium uppercase tracking-wider text-neutral-500">
        Top Topics
      </h3>
      <div className="flex flex-col gap-2.5">
        {data.topicStats.slice(0, 5).map((t) => (
          <div key={t.topic}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-neutral-300">{t.topic}</span>
              <span className="font-mono tabular-nums text-emerald-400">
                {t.avg_engagement.toFixed(3)}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-neutral-900">
              <span
                className="block h-full rounded-full bg-neutral-100"
                style={{ width: `${Math.min(100, t.avg_engagement * 100)}%` }}
              />
            </div>
          </div>
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
