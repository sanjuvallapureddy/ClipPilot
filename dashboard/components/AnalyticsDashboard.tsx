"use client";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Sparkles,
  Activity,
  Send,
  Eye,
  Flame,
  Clock,
  Layers,
  TrendingUp,
  Trophy,
  RefreshCw,
} from "lucide-react";
import type { Patterns } from "@/lib/types";

// ---- palette (color-coded, vivid but Linear/Vercel-calm) --------------------
const PALETTE = [
  "#8b5cf6", // violet
  "#3b82f6", // blue
  "#22d3ee", // cyan
  "#34d399", // emerald
  "#f59e0b", // amber
  "#fb7185", // rose
  "#e879f9", // fuchsia
  "#a3e635", // lime
];

// low score -> rose, mid -> amber, high -> emerald
function scoreColor(score: number) {
  if (score >= 0.66) return "#34d399";
  if (score >= 0.33) return "#f59e0b";
  return "#fb7185";
}

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

interface Detailed {
  generatedAt: number;
  degraded?: boolean;
  reason?: string;
  totals: {
    moments: number;
    rendered: number;
    posted: number;
    notPosted: number;
    views: number;
    likes: number;
    shares: number;
    avgVirality: number;
    topVirality: number;
  };
  clips: ClipLite[];
  byTopic: {
    topic: string;
    clips: number;
    avgEngagement: number;
    views: number;
    posted: number;
  }[];
  scoreBuckets: { bucket: string; count: number }[];
  lengthBuckets: { bucket: string; count: number }[];
  funnel: { stage: string; count: number }[];
  patterns: Patterns | null;
}

type SortKey = "score" | "length" | "views" | "topic" | "recency";

const tooltipStyle = {
  background: "#0a0a0a",
  border: "1px solid #262626",
  borderRadius: 10,
  fontSize: 12,
  padding: "8px 10px",
};

export default function AnalyticsDashboard() {
  const [data, setData] = useState<Detailed | null>(null);
  const [sort, setSort] = useState<SortKey>("score");
  const [topicMetric, setTopicMetric] = useState<"avgEngagement" | "views" | "clips">(
    "avgEngagement",
  );
  const [refreshing, setRefreshing] = useState(false);

  const load = useMemo(
    () => async () => {
      try {
        setRefreshing(true);
        const d = await fetch("/api/analytics/detailed").then((r) => r.json());
        setData(d);
      } catch {
        /* keep last good data */
      } finally {
        setRefreshing(false);
      }
    },
    [],
  );

  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  const clips = data?.clips ?? [];
  const hasData = clips.length > 0;

  const sortedClips = useMemo(() => {
    const arr = [...clips];
    switch (sort) {
      case "length":
        return arr.sort((a, b) => b.length - a.length);
      case "views":
        return arr.sort((a, b) => b.views - a.views);
      case "topic":
        return arr.sort((a, b) => a.topic.localeCompare(b.topic));
      case "recency":
        return arr.sort((a, b) => b.posted_ts - a.posted_ts);
      default:
        return arr.sort((a, b) => b.engagement - a.engagement);
    }
  }, [clips, sort]);

  const topicSeries = useMemo(() => {
    const arr = [...(data?.byTopic ?? [])];
    return arr
      .sort((a, b) => (b[topicMetric] as number) - (a[topicMetric] as number))
      .slice(0, 8);
  }, [data?.byTopic, topicMetric]);

  // Cumulative reach over time (REAL posted clips only). Empty until clips are posted.
  const reachSeries = useMemo(() => {
    const posted = clips
      .filter((c) => c.posted_ts > 0)
      .sort((a, b) => a.posted_ts - b.posted_ts);
    let cum = 0;
    return posted.map((c) => {
      cum += c.views;
      return {
        t: new Date(c.posted_ts).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
        views: cum,
      };
    });
  }, [clips]);

  const t = data?.totals;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-6">
      {/* degraded banner */}
      {data?.degraded && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-900/50 bg-amber-950/20 px-4 py-2.5 text-xs text-amber-300/90">
          <Activity size={13} />
          Live data source is offline (Redis / orchestrator). Showing the empty state — start
          the backend and run the pipeline to populate these graphs with real moments.
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Moments" value={t?.moments ?? 0} icon={Sparkles} color="#8b5cf6" />
        <Kpi
          label="Avg Virality"
          value={(t?.avgVirality ?? 0).toFixed(2)}
          icon={Activity}
          color="#3b82f6"
        />
        <Kpi
          label="Top Virality"
          value={(t?.topVirality ?? 0).toFixed(2)}
          icon={Flame}
          color="#f59e0b"
        />
        <Kpi label="Rendered" value={t?.rendered ?? 0} icon={Layers} color="#22d3ee" />
        <Kpi label="Posted" value={t?.posted ?? 0} icon={Send} color="#34d399" />
        <Kpi
          label="Total Views"
          value={(t?.views ?? 0).toLocaleString()}
          icon={Eye}
          color="#e879f9"
        />
      </div>

      {/* Row 1: virality distribution + pipeline funnel */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <ChartCard
          title="Predicted virality distribution"
          hint="GPT virality scores bucketed 0 → 1"
          icon={TrendingUp}
          empty={!hasData}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data?.scoreBuckets ?? []} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#171717" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fill: "#737373", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#262626" }} />
              <YAxis allowDecimals={false} tick={{ fill: "#737373", fontSize: 10 }} tickLine={false} axisLine={false} />
              <RTooltip contentStyle={tooltipStyle} labelStyle={{ color: "#a3a3a3" }} cursor={{ fill: "#ffffff08" }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={900}>
                {(data?.scoreBuckets ?? []).map((b, i) => (
                  <Cell key={b.bucket} fill={scoreColor(i / 10 + 0.05)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Pipeline funnel"
          hint="Detected → Rendered → Posted"
          icon={Layers}
          empty={!hasData}
        >
          <div className="flex h-[220px] flex-col justify-center gap-3 px-1">
            {(data?.funnel ?? []).map((f, i) => {
              const max = Math.max(1, data?.funnel?.[0]?.count ?? 1);
              const pct = Math.round((f.count / max) * 100);
              const color = PALETTE[i % PALETTE.length];
              return (
                <div key={f.stage}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-neutral-300">{f.stage}</span>
                    <span className="font-medium tabular-nums" style={{ color }}>
                      {f.count}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-neutral-900">
                    <motion.span
                      className="block h-full rounded-full"
                      style={{ background: color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: i * 0.08 }}
                    />
                  </div>
                </div>
              );
            })}
            <p className="mt-2 text-[11px] leading-relaxed text-neutral-600">
              Render needs OpenShorts; posting needs platform credentials. Until wired, clips
              stay at “Detected”.
            </p>
          </div>
        </ChartCard>
      </div>

      {/* Row 2: virality by topic (sortable) + length distribution */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <ChartCard
          title="By topic"
          icon={Trophy}
          empty={topicSeries.length === 0}
          action={
            <Segmented
              value={topicMetric}
              onChange={(v) => setTopicMetric(v as typeof topicMetric)}
              options={[
                { value: "avgEngagement", label: "Virality" },
                { value: "views", label: "Views" },
                { value: "clips", label: "Clips" },
              ]}
            />
          }
        >
          <ResponsiveContainer width="100%" height={Math.max(220, topicSeries.length * 38)}>
            <BarChart
              layout="vertical"
              data={topicSeries}
              margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
            >
              <CartesianGrid stroke="#171717" horizontal={false} />
              <XAxis type="number" tick={{ fill: "#737373", fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis
                type="category"
                dataKey="topic"
                width={96}
                tick={{ fill: "#a3a3a3", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <RTooltip contentStyle={tooltipStyle} labelStyle={{ color: "#a3a3a3" }} cursor={{ fill: "#ffffff08" }} />
              <Bar
                dataKey={topicMetric}
                radius={[0, 4, 4, 0]}
                isAnimationActive
                animationDuration={900}
              >
                {topicSeries.map((s, i) => (
                  <Cell key={s.topic} fill={PALETTE[i % PALETTE.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Clip length distribution" hint="seconds" icon={Clock} empty={!hasData}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data?.lengthBuckets ?? []} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid stroke="#171717" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fill: "#737373", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#262626" }} />
              <YAxis allowDecimals={false} tick={{ fill: "#737373", fontSize: 10 }} tickLine={false} axisLine={false} />
              <RTooltip contentStyle={tooltipStyle} labelStyle={{ color: "#a3a3a3" }} cursor={{ fill: "#ffffff08" }} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={900}>
                {(data?.lengthBuckets ?? []).map((b, i) => (
                  <Cell key={b.bucket} fill={PALETTE[(i + 2) % PALETTE.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 3: reach over time (real, honest empty) */}
      <ChartCard
        title="Audience reach over time"
        hint="cumulative real views from posted clips"
        icon={Eye}
        empty={reachSeries.length === 0}
        emptyLabel="No posted clips yet — reach appears once clips are posted with real platform metrics."
      >
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={reachSeries} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="reachFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#171717" vertical={false} />
            <XAxis dataKey="t" tick={{ fill: "#737373", fontSize: 10 }} tickLine={false} axisLine={{ stroke: "#262626" }} />
            <YAxis tick={{ fill: "#737373", fontSize: 10 }} tickLine={false} axisLine={false} />
            <RTooltip contentStyle={tooltipStyle} labelStyle={{ color: "#a3a3a3" }} />
            <Area
              type="monotone"
              dataKey="views"
              stroke="#22d3ee"
              fill="url(#reachFill)"
              strokeWidth={2}
              isAnimationActive
              animationDuration={1000}
            />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* Row 4: clip explorer (sortable table) */}
      <ChartCard
        title="Clip explorer"
        icon={Flame}
        empty={!hasData}
        action={
          <Segmented
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            options={[
              { value: "score", label: "Virality" },
              { value: "length", label: "Length" },
              { value: "views", label: "Views" },
              { value: "recency", label: "Recent" },
              { value: "topic", label: "Topic" },
            ]}
          />
        }
      >
        <div className="overflow-hidden rounded-lg border border-neutral-900">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-950/60 text-[10px] uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">Moment</th>
                <th className="px-3 py-2 font-medium">Topic</th>
                <th className="px-3 py-2 text-right font-medium">Virality</th>
                <th className="px-3 py-2 text-right font-medium">Length</th>
                <th className="px-3 py-2 text-right font-medium">Views</th>
                <th className="px-3 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {sortedClips.slice(0, 40).map((c, i) => (
                <motion.tr
                  key={c.clip_id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.02, 0.4) }}
                  className="border-t border-neutral-900 hover:bg-neutral-950/50"
                >
                  <td className="max-w-[260px] truncate px-3 py-2.5 text-neutral-300">
                    {c.hook || c.title}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-md border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-[10px] text-neutral-400">
                      {c.topic}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span
                      className="font-medium tabular-nums"
                      style={{ color: scoreColor(c.engagement) }}
                    >
                      {c.engagement.toFixed(3)}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-400">
                    {c.length ? `${c.length}s` : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-neutral-400">
                    {c.views ? c.views.toLocaleString() : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusChip render={c.render_status} post={c.post_status} />
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </ChartCard>

      {/* learned patterns */}
      {data?.patterns && (
        <div className="rounded-xl border border-neutral-900 bg-neutral-950/40 p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-neutral-200">
            <Trophy size={14} className="text-amber-400" />
            Learned winning patterns
          </div>
          <p className="mb-3 text-sm text-neutral-400">{data.patterns.summary}</p>
          <div className="flex flex-wrap gap-1.5">
            {data.patterns.winning_topics?.map((tp) => (
              <span
                key={tp}
                className="rounded-md border border-neutral-800 bg-black px-2 py-0.5 text-[11px] text-neutral-300"
              >
                {tp}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-1.5 text-[11px] text-neutral-600">
        <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
        live · refreshes every 6s
      </div>
    </div>
  );
}

// ---- small building blocks --------------------------------------------------

function Kpi({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string | number;
  icon: typeof Sparkles;
  color: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-neutral-900 bg-neutral-950/40 p-4">
      <div
        className="absolute -right-6 -top-6 h-16 w-16 rounded-full opacity-20 blur-2xl"
        style={{ background: color }}
      />
      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-neutral-500">
        <Icon size={12} style={{ color }} />
        {label}
      </div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums text-neutral-100">
        {value}
      </div>
    </div>
  );
}

function ChartCard({
  title,
  hint,
  icon: Icon,
  action,
  empty,
  emptyLabel,
  children,
}: {
  title: string;
  hint?: string;
  icon: typeof Sparkles;
  action?: React.ReactNode;
  empty?: boolean;
  emptyLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-neutral-900 bg-neutral-950/40 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-neutral-500" />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-medium text-neutral-200">{title}</span>
            {hint && <span className="text-[11px] text-neutral-600">{hint}</span>}
          </div>
        </div>
        {action}
      </div>
      {empty ? (
        <div className="flex h-[200px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-neutral-800 text-center">
          <span className="text-xs text-neutral-400">No data yet</span>
          <span className="max-w-xs text-[11px] text-neutral-600">
            {emptyLabel ?? "Run the pipeline to populate this chart with real moments."}
          </span>
        </div>
      ) : (
        children
      )}
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-950 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`relative rounded-md px-2.5 py-1 text-[11px] transition-colors ${
            value === o.value ? "text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
          }`}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${options.map((x) => x.value).join("-")}`}
              className="absolute inset-0 rounded-md bg-neutral-800"
              transition={{ type: "spring", stiffness: 400, damping: 32 }}
            />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

function StatusChip({ render, post }: { render: string; post: string }) {
  if (post === "posted")
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-900/60 bg-emerald-950/30 px-1.5 py-0.5 text-[10px] text-emerald-300">
        posted
      </span>
    );
  if (render === "rendered")
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-cyan-900/60 bg-cyan-950/30 px-1.5 py-0.5 text-[10px] text-cyan-300">
        rendered
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-950 px-1.5 py-0.5 text-[10px] text-neutral-500">
      detected
    </span>
  );
}
