"use client";
// Virality Predictor — rates multiple clips (mock today, OpenShorts multi-clip output later).
// Shows best-pick stats on top, pie + retention/engagement charts, clip comparison, and a
// copilot-facing "why" panel. Exposes selection to CopilotKit via useCopilotReadable.
import { useMemo, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  TrendingUp,
  Trophy,
  Eye,
  Heart,
  Share2,
  Percent,
  MessageCircle,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { useCopilotReadable } from "@copilotkit/react-core";
import { useCopilotChatSuggestions, useChatContext } from "@copilotkit/react-ui";
import { getClipPredictions, getBestPrediction } from "@/lib/virality-mock";
import type { LucideIcon } from "lucide-react";
import { SectionCard, Badge, GlowMetricCard, OdometerNumber, Button } from "@/components/ui";
import { formatScore } from "@/lib/format";
import { compact } from "@/lib/num";

const CHART_TOOLTIP = {
  contentStyle: {
    background: "#0a0a0a",
    border: "1px solid #262626",
    borderRadius: 6,
    fontSize: 11,
    padding: "6px 10px",
  },
  labelStyle: { color: "#737373", marginBottom: 2 },
  itemStyle: { color: "#e5e5e5" },
  cursor: { stroke: "#404040", strokeWidth: 1 },
};

const AXIS_TICK = { fill: "#525252", fontSize: 10 };
const GRID = { stroke: "#1a1a1a", strokeDasharray: "2 6", vertical: false };

const COPILOT_PROMPTS = [
  "Why is the top clip predicted to go viral?",
  "Compare retention curves — which clip holds viewers best?",
  "What should I post first and why?",
  "Which factor hurts clip #3 the most?",
];

export default function ViralityPredictor() {
  const clips = useMemo(() => getClipPredictions(), []);
  const best = useMemo(() => getBestPrediction(), []);
  const [selectedId, setSelectedId] = useState(best.clip_id);

  const selected =
    clips.find((c) => c.clip_id === selectedId) ?? best;

  // Copilot reads the full prediction set + the user's current selection so it can explain WHY.
  useCopilotReadable({
    description:
      "Virality predictions for multiple clips (mock until OpenShorts). Includes scores, " +
      "factor breakdown, retention/engagement curves, and reasoning bullets. User may ask " +
      "WHY a clip is rated highly — cite why_bullets and factors from the selected clip.",
    value: {
      source: "mock",
      note: "Replace with OpenShorts multi-clip output when wired.",
      best_clip_id: best.clip_id,
      selected_clip_id: selected.clip_id,
      clips: clips.map((c) => ({
        clip_id: c.clip_id,
        rank: c.rank,
        title: c.title,
        hook: c.hook,
        topic: c.topic,
        virality_score: c.virality_score,
        predicted_views: c.predicted_views,
        predicted_retention_pct: c.predicted_retention_pct,
        confidence: c.confidence,
        factors: c.factors,
        reasoning: c.reasoning,
        why_bullets: c.why_bullets,
      })),
    },
  });

  // Surface the clip/virality prompts as suggestion chips inside the sidebar chat itself.
  useCopilotChatSuggestions({
    available: "before-first-message",
    suggestions: COPILOT_PROMPTS.map((p) => ({ title: p, message: p })),
  });

  // The sidebar is mounted in layout.tsx and renders the app inside its ChatContext,
  // so we can open it programmatically from here.
  const { setOpen } = useChatContext();

  const askCopilot = () => {
    setOpen(true);
    // Focus the sidebar's chat textarea once it's visible.
    requestAnimationFrame(() => {
      const ta = document.querySelector<HTMLTextAreaElement>(
        ".copilotKitSidebarContentWrapper textarea",
      );
      ta?.focus();
    });
  };

  const compareData = clips.map((c) => ({
    name: `#${c.rank}`,
    virality: c.virality_score,
    retention: c.predicted_retention_pct,
    views: Math.round(c.predicted_views / 1000),
  }));

  return (
    <SectionCard
      title="Virality Predictor"
      icon={TrendingUp}
      right={
        <Badge className="border-amber-900/50 text-amber-400/90">
          <Sparkles size={10} />
          mock · OpenShorts soon
        </Badge>
      }
    >
      {/* ---- Best pick hero ---- */}
      <div className="mb-5 rounded-xl border border-emerald-900/40 bg-gradient-to-br from-emerald-950/30 via-black to-black p-4">
        <div className="mb-3 flex items-center gap-2">
          <Trophy size={14} className="text-emerald-400" />
          <span className="text-[10px] font-medium uppercase tracking-widest text-emerald-400/90">
            Best predicted clip
          </span>
          <span className="ml-auto font-mono text-[10px] text-neutral-600">
            {best.confidence}% confidence
          </span>
        </div>
        <h3 className="text-sm font-medium text-neutral-100">{best.title}</h3>
        <p className="mt-1 font-mono text-[11px] text-neutral-500">&ldquo;{best.hook}&rdquo;</p>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <HeroStat
            label="Virality"
            value={`${formatScore(best.virality_score)}`}
            suffix="/100"
            accent="text-emerald-400"
          />
          <HeroStat
            label="Pred. views"
            value={compact(best.predicted_views)}
            icon={Eye}
          />
          <HeroStat
            label="Retention"
            value={`${Math.round(best.predicted_retention_pct)}%`}
            icon={Percent}
          />
          <HeroStat
            label="Pred. shares"
            value={compact(best.predicted_shares)}
            icon={Share2}
          />
        </div>
      </div>

      {/* ---- Clip picker row ---- */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {clips.map((c) => (
          <button
            key={c.clip_id}
            onClick={() => setSelectedId(c.clip_id)}
            className={`shrink-0 rounded-lg border px-3 py-2 text-left transition-all ${
              selectedId === c.clip_id
                ? "border-neutral-600 bg-neutral-900/80 ring-1 ring-neutral-700"
                : "border-neutral-900 bg-neutral-950/50 hover:border-neutral-800"
            }`}
          >
            <div className="flex items-center gap-2">
              <span
                className={`font-mono text-xs font-semibold tabular-nums ${
                  c.rank === 1 ? "text-emerald-400" : "text-neutral-300"
                }`}
              >
                {formatScore(c.virality_score)}
              </span>
              {c.rank === 1 && <Trophy size={10} className="text-emerald-500" />}
            </div>
            <p className="mt-0.5 max-w-[140px] truncate text-[10px] text-neutral-500">
              {c.title}
            </p>
          </button>
        ))}
      </div>

      {/* ---- Charts grid ---- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Factor pie */}
        <ChartPanel title="Virality factor mix" sub="selected clip">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={selected.factors}
                  dataKey="score"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={72}
                  paddingAngle={2}
                  animationDuration={900}
                >
                  {selected.factors.map((f) => (
                    <Cell key={f.id} fill={f.color} stroke="#0a0a0a" strokeWidth={2} />
                  ))}
                </Pie>
                <Tooltip {...CHART_TOOLTIP} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-x-3 gap-y-1">
            {selected.factors.map((f) => (
              <span
                key={f.id}
                className="inline-flex items-center gap-1 font-mono text-[9px] text-neutral-500"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: f.color }}
                />
                {f.label} {formatScore(f.score)}
              </span>
            ))}
          </div>
        </ChartPanel>

        {/* Retention curve */}
        <ChartPanel title="Predicted retention" sub="% still watching">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={selected.retention_curve} margin={{ top: 12, right: 12, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="retentionFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#34d399" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID} />
                <XAxis
                  dataKey="second"
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(s) => `${s}s`}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `${v}%`}
                  width={36}
                />
                <Tooltip
                  {...CHART_TOOLTIP}
                  formatter={(v: number) => [`${Math.round(v)}%`, "retention"]}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#34d399"
                  strokeWidth={1.5}
                  fill="url(#retentionFill)"
                  dot={false}
                  activeDot={{ r: 3, fill: "#34d399", stroke: "#0a0a0a", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartPanel>

        {/* Engagement intensity */}
        <ChartPanel title="Engagement intensity" sub="predicted over timeline">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={selected.engagement_curve} margin={{ top: 12, right: 12, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="engagementFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID} />
                <XAxis
                  dataKey="second"
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(s) => `${s}s`}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={AXIS_TICK}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <Tooltip
                  {...CHART_TOOLTIP}
                  formatter={(v: number) => [Math.round(v), "intensity"]}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="#a78bfa"
                  strokeWidth={1.5}
                  fill="url(#engagementFill)"
                  dot={false}
                  activeDot={{ r: 3, fill: "#a78bfa", stroke: "#0a0a0a", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartPanel>

        {/* Compare all clips */}
        <ChartPanel title="Clip comparison" sub="virality vs retention">
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={compareData} margin={{ top: 12, right: 12, left: -16, bottom: 0 }} barCategoryGap="20%">
                <CartesianGrid {...GRID} />
                <XAxis dataKey="name" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} />
                <Tooltip {...CHART_TOOLTIP} />
                <Bar dataKey="virality" fill="#e5e5e5" radius={[3, 3, 0, 0]} maxBarSize={28} />
                <Bar dataKey="retention" fill="#38bdf8" radius={[3, 3, 0, 0]} maxBarSize={28} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartPanel>
      </div>

      {/* Selected clip detail metrics */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <GlowMetricCard
          title="Virality"
          variant="amber"
          value={selected.virality_score}
          description="/ 100"
        />
        <GlowMetricCard
          title="Pred. likes"
          variant="red"
          icon={Heart}
          value={<OdometerNumber value={selected.predicted_likes} />}
        />
        <GlowMetricCard
          title="Retention"
          variant="cyan"
          icon={Percent}
          value={`${selected.predicted_retention_pct}%`}
          description="avg"
        />
        <GlowMetricCard
          title="Length"
          variant="blue"
          value={`${selected.length_seconds}s`}
          description={selected.topic}
        />
      </div>

      {/* ---- Copilot "WHY" panel (chat lives in sidebar; this surfaces reasoning + prompts) ---- */}
      <div className="mt-5 rounded-xl border border-neutral-800 bg-neutral-950/60">
        <div className="flex items-center gap-2 border-b border-neutral-900 px-4 py-3">
          <MessageCircle size={14} className="text-violet-400" />
          <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">
            Copilot · Why this rating?
          </span>
          <span className="ml-auto font-mono text-[10px] text-neutral-600">
            ask in the chat below ↓
          </span>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={selected.clip_id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-3 px-4 py-4"
          >
            <p className="text-sm leading-relaxed text-neutral-300">{selected.reasoning}</p>
            <ul className="space-y-1.5">
              {selected.why_bullets.map((b, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 font-mono text-[11px] leading-snug text-neutral-500"
                >
                  <ChevronRight size={12} className="mt-0.5 shrink-0 text-violet-500/80" />
                  {b}
                </li>
              ))}
            </ul>
          </motion.div>
        </AnimatePresence>

        <div className="border-t border-neutral-900 px-4 py-3">
          <Button variant="ghost" onClick={askCopilot} type="button">
            <MessageCircle size={13} className="text-violet-400" />
            Ask the Copilot
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

function ChartPanel({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-neutral-900 bg-black/40 p-3">
      <div className="mb-2">
        <h4 className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">
          {title}
        </h4>
        <p className="font-mono text-[9px] text-neutral-700">{sub}</p>
      </div>
      {children}
    </div>
  );
}

function HeroStat({
  label,
  value,
  suffix,
  accent = "text-neutral-100",
  icon: Icon,
}: {
  label: string;
  value: string;
  suffix?: string;
  accent?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="rounded-lg border border-neutral-900/80 bg-black/50 px-3 py-2">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-neutral-600">
        {Icon && <Icon size={10} />}
        {label}
      </div>
      <div className={`mt-0.5 font-mono text-lg font-semibold tabular-nums ${accent}`}>
        {value}
        {suffix && (
          <span className="text-xs font-normal text-neutral-600">{suffix}</span>
        )}
      </div>
    </div>
  );
}
