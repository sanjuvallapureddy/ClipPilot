"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { useCopilotChatSuggestions } from "@copilotkit/react-ui";
import {
  Search,
  Globe,
  Play,
  Square,
  Power,
  Repeat,
  ListVideo,
  Hash,
  Loader2,
  BarChart3,
  Trophy,
  TrendingUp,
  GraduationCap,
  Check,
  X,
} from "lucide-react";
import { getClipPredictions } from "@/lib/virality-mock";
import LivePipeline from "@/components/LivePipeline";
import DiscoveredQueue from "@/components/DiscoveredQueue";
import ClipsGallery from "@/components/ClipsGallery";
import Analytics from "@/components/Analytics";
import SelfLearning from "@/components/SelfLearning";
import ActivityTicker from "@/components/ActivityTicker";
import CommandMenu from "@/components/CommandMenu";
import YouTubeConnect from "@/components/YouTubeConnect";
import ManualUpload from "@/components/ManualUpload";
import RecentClipHistory from "@/components/RecentClipHistory";
import MockEditingStudio from "@/components/MockEditingStudio";
import ViralityPredictor from "@/components/ViralityPredictor";
import Aurora from "@/components/Aurora";
import ScrollProgress from "@/components/ScrollProgress";
import { NAV_ITEMS } from "@/components/Sidebar";
import { useSectionNav } from "@/components/section-nav";
import { motion } from "framer-motion";
import {
  MagneticButton,
  Card,
  GlowMetricCard,
  Badge,
  StagePill,
  Tooltip,
  OdometerNumber,
  Reveal,
} from "@/components/ui";
import { toast, dismiss } from "@/components/toast";
import type { Stage } from "@/lib/types";

async function control(action: string, payload: unknown = {}) {
  const res = await fetch("/api/control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  return res.json();
}

async function callControl(action: string, payload: unknown = {}) {
  const res = await fetch("/api/control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

const HISTORY = 12;

// Human-in-the-loop confirmation card for starting the autonomous loop. Rendered by the
// `startAutonomousLoop` action via `renderAndWaitForResponse`: the copilot pauses here until
// the user clicks Confirm (which runs the start) or Cancel. Module-scoped so its local
// `submitting` state survives re-renders while the start request is in flight.
function ConfirmStartLoop({
  status,
  args,
  respond,
  result,
  defaultTopic,
  onConfirm,
}: {
  status: string;
  args: any;
  respond?: (value: any) => void;
  result?: { confirmed?: boolean; topic?: string };
  defaultTopic: string;
  onConfirm: (topic: string, intervalSeconds?: number) => Promise<{ ok: boolean }>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const topic = (args?.topic || defaultTopic || "tech").trim();
  const interval = args?.interval_seconds;

  if (status === "complete") {
    const confirmed = result?.confirmed;
    return (
      <Card className="my-1">
        <div className="flex items-center gap-2">
          {confirmed ? (
            <Check size={14} className="text-emerald-400" />
          ) : (
            <X size={14} className="text-neutral-500" />
          )}
          <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">
            {confirmed ? "Autonomous loop started" : "Start cancelled"}
          </span>
        </div>
        {confirmed && (
          <div className="mt-2 font-mono text-[11px] text-neutral-500">
            topic “{result?.topic ?? topic}” · watch cycles run in Live Pipeline →
          </div>
        )}
      </Card>
    );
  }

  if (status !== "executing") {
    return (
      <Card className="my-1">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Loader2 size={12} className="animate-spin" />
          Preparing autonomous loop…
        </div>
      </Card>
    );
  }

  return (
    <Card className="my-1">
      <div className="flex items-center gap-2 pb-2">
        <Power size={14} className="text-rose-400" />
        <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">
          Start autonomous loop?
        </span>
      </div>
      <p className="pb-3 text-xs leading-relaxed text-neutral-400">
        ClipPilot will run unattended on{" "}
        <span className="font-mono text-neutral-200">“{topic}”</span>
        {interval ? (
          <>
            {" "}
            every <span className="font-mono text-neutral-200">{interval}s</span>
          </>
        ) : null}
        : discover → clip → post → learn → repeat.
      </p>
      <div className="flex items-center gap-2">
        <MagneticButton
          variant="primary"
          disabled={submitting}
          onClick={async () => {
            setSubmitting(true);
            try {
              const r = await onConfirm(topic, interval);
              respond?.({ confirmed: true, topic, interval_seconds: interval, ok: r.ok });
            } catch {
              respond?.({ confirmed: true, topic, ok: false });
            }
          }}
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
          {submitting ? "Starting…" : "Confirm & start"}
        </MagneticButton>
        <MagneticButton
          variant="ghost"
          disabled={submitting}
          onClick={() => respond?.({ confirmed: false })}
        >
          <X size={14} />
          Cancel
        </MagneticButton>
      </div>
    </Card>
  );
}

export default function Page() {
  const [status, setStatus] = useState<any>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [cyclesHist, setCyclesHist] = useState<number[]>([]);
  const [queueHist, setQueueHist] = useState<number[]>([]);
  // Contract-backed context the copilot can read & answer questions from (queue/clips/analytics).
  const [ctx, setCtx] = useState<{ queue: any[]; clips: any[]; analytics: any }>({
    queue: [],
    clips: [],
    analytics: null,
  });
  const contentRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { activeSection, setActiveSection } = useSectionNav();
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);
  const running = status?.running;

  // Slim, copilot-friendly virality snapshot (mock until OpenShorts emits multiple clips).
  const viralityTop = useMemo(
    () =>
      getClipPredictions()
        .slice(0, 5)
        .map((c) => ({
          clip_id: c.clip_id,
          title: c.title,
          topic: c.topic,
          virality_score: c.virality_score,
          predicted_retention_pct: c.predicted_retention_pct,
          why: c.why_bullets.slice(0, 2),
        })),
    [],
  );

  // Sidebar + command menu drive which section is visible. Analytics is a standalone
  // route; everything else is an in-page tab swap.
  const navigate = useCallback(
    (id: string) => {
      if (id === "analytics") {
        router.push("/analytics");
        return;
      }
      setActiveSection(id);
    },
    [router, setActiveSection],
  );

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/control");
      const j = await r.json();
      setStatus(j);
      setOnline(r.ok);
      if (r.ok) {
        setCyclesHist((h) => [...h, Number(j?.cycles ?? 0)].slice(-HISTORY));
        setQueueHist((h) => [...h, Number(j?.queue_pending ?? 0)].slice(-HISTORY));
      }
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 4000);
    return () => clearInterval(t);
  }, [loadStatus]);

  // Pull the contract-backed context the copilot answers from. Kept slim so readable payloads
  // stay small; refreshed on a slow timer and after every action (bump() advances refreshKey).
  const loadContext = useCallback(async () => {
    const [q, c, a] = await Promise.all([
      fetch("/api/queue").then((r) => r.json()).catch(() => ({ items: [] })),
      fetch("/api/clips").then((r) => r.json()).catch(() => ({ clips: [] })),
      fetch("/api/analytics").then((r) => r.json()).catch(() => null),
    ]);
    setCtx({
      queue: (q?.items || []).slice(0, 8).map((it: any) => ({
        title: it.title,
        podcast: it.podcast,
        topic: it.topic,
        trend_score: it.trend_score,
        source: it.source,
      })),
      clips: (c?.clips || []).slice(0, 8).map((cl: any) => ({
        clip_id: cl.clip_id,
        hook: cl.hook,
        quote: cl.quote,
        topic: cl.topic,
        length_seconds: cl.length_seconds,
        render_status: cl.render_status,
        post_status: cl.post_status,
        views: cl.views,
        engagement_score: cl.engagement_score,
      })),
      analytics: a
        ? { totals: a.totals, topTopics: (a.topicStats || []).slice(0, 5), patterns: a.patterns }
        : null,
    });
  }, []);

  useEffect(() => {
    loadContext();
    const t = setInterval(loadContext, 8000);
    return () => clearInterval(t);
  }, [loadContext]);

  useEffect(() => {
    loadContext();
  }, [refreshKey, loadContext]);

  // --- Copilot context (readables) ---
  useCopilotReadable(
    {
      description:
        "ClipPilot live state: whether Lane A (the discovery orchestrator) is reachable, " +
        "whether the autonomous loop is running, the active topic, total cycles run, and the " +
        "pending queue depth.",
      value: {
        orchestrator_online: online,
        autonomous_loop_running: !!running,
        current_topic: status?.topic ?? null,
        cycles_run: Number(status?.cycles ?? 0),
        queue_pending: Number(status?.queue_pending ?? 0),
      },
    },
    [online, running, status?.topic, status?.cycles, status?.queue_pending],
  );

  useCopilotReadable(
    {
      description:
        "Raw orchestrator status payload from Lane A (/status), including winning patterns when " +
        "Lane B has learned any.",
      value: status,
    },
    [status],
  );

  useCopilotReadable(
    {
      description:
        "Discovered queue — top trending podcast candidates waiting to be clipped, ranked by " +
        "trend score (higher = stronger viral signal).",
      value: ctx.queue,
    },
    [ctx.queue],
  );

  useCopilotReadable(
    {
      description:
        "Recently detected viral-moment clips: hook, quote, topic, length, render/post status, " +
        "predicted engagement, and real view counts (0 until actually posted).",
      value: ctx.clips,
    },
    [ctx.clips],
  );

  useCopilotReadable(
    {
      description:
        "Performance analytics and the winning patterns learned by Lane B (top topics, ideal " +
        "length, caption/hook style). Real metrics appear once clips are posted.",
      value: ctx.analytics,
    },
    [ctx.analytics],
  );

  useCopilotReadable(
    {
      description:
        "Predicted virality ranking for candidate clips (0–100 score, retention %, and the top " +
        "reasons WHY each would perform). Mock predictions until OpenShorts multi-clip output is wired.",
      value: viralityTop,
    },
    [viralityTop],
  );

  // --- Contextual chat suggestions (adapt to the live state above) ---
  useCopilotChatSuggestions(
    {
      instructions:
        "Suggest 3–4 short, action-oriented things to do next in ClipPilot (mission control for " +
        "an autonomous podcast→shorts agent). Tailor them to the current state:\n" +
        `- orchestrator online: ${online}\n` +
        `- autonomous loop running: ${!!running}\n` +
        `- current topic: ${status?.topic ?? "none set"}\n` +
        `- queue pending: ${Number(status?.queue_pending ?? 0)}\n` +
        `- clips detected: ${ctx.clips.length}\n` +
        "If the loop is running, suggest stopping it or reviewing analytics/winning patterns. If " +
        "it's stopped, suggest starting the autonomous loop or running one cycle. If no topic is " +
        "set, suggest discovering a trending topic (e.g. AI, tech, business). If clips exist, " +
        "suggest rating their virality. Keep each suggestion under ~8 words.",
      minSuggestions: 3,
      maxSuggestions: 4,
    },
    [online, running, status?.topic, status?.queue_pending, ctx.clips.length],
  );

  // Preflight: every control action proxies to Lane A (the discovery orchestrator on
  // :8000). If it's offline, fail fast with an actionable message instead of a vague error.
  const ensureOrchestrator = useCallback(() => {
    if (online === false) {
      toast(
        "Orchestrator offline — start Lane A:  uvicorn discovery_orchestrator.app:app --port 8000",
        "error",
      );
      return false;
    }
    return true;
  }, [online]);

  // --- Control actions with toast feedback ---
  const doDiscover = useCallback(async () => {
    if (busy || !ensureOrchestrator()) return;
    setBusy(true);
    const id = toast("Discovering trending podcasts…", "loading");
    try {
      const { ok, data } = await callControl("discover", {
        topic: status?.topic || "tech",
      });
      dismiss(id);
      if (ok) toast(`Queued ${data?.count ?? 0} candidates`, "success");
      else toast("Discovery failed — is the orchestrator running?", "error");
    } catch {
      dismiss(id);
      toast("Discovery failed — orchestrator unreachable", "error");
    } finally {
      setBusy(false);
      bump();
    }
  }, [busy, status?.topic, bump, ensureOrchestrator]);

  const doResearch = useCallback(async () => {
    if (busy || !ensureOrchestrator()) return;
    setBusy(true);
    const id = toast("Researching this week's trending episodes…", "loading");
    try {
      const { ok, data } = await callControl("research", {
        topic: status?.topic || "tech",
      });
      dismiss(id);
      if (ok) toast(`Queued ${data?.count ?? 0} researched episodes`, "success");
      else toast("Research failed — is the orchestrator running?", "error");
    } catch {
      dismiss(id);
      toast("Research failed — orchestrator unreachable", "error");
    } finally {
      setBusy(false);
      bump();
    }
  }, [busy, status?.topic, bump, ensureOrchestrator]);

  const doRunOnce = useCallback(async () => {
    if (busy || !ensureOrchestrator()) return;
    setBusy(true);
    const id = toast("Running one autonomous cycle…", "loading");
    try {
      const { ok, data } = await callControl("run-once", {});
      dismiss(id);
      if (ok) toast(`Job ${data?.job_id ?? "started"} → ${data?.stage ?? "queued"}`, "success");
      else toast("Run failed — is the orchestrator running?", "error");
    } catch {
      dismiss(id);
      toast("Run failed — orchestrator unreachable", "error");
    } finally {
      setBusy(false);
      bump();
    }
  }, [busy, bump, ensureOrchestrator]);

  const doToggleAuto = useCallback(async () => {
    if (!ensureOrchestrator()) return;
    const turningOn = !running;
    const { ok } = await callControl(turningOn ? "start" : "stop", {
      topic: status?.topic || "tech",
    });
    if (ok) toast(turningOn ? "Autonomous loop started" : "Autonomous loop stopped", "success");
    else toast("Could not reach the orchestrator", "error");
    loadStatus();
  }, [running, status?.topic, loadStatus, ensureOrchestrator]);

  // --- Global single-key shortcuts (ignored while typing) ---
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
        return;
      const k = e.key.toLowerCase();
      if (k === "r") {
        e.preventDefault();
        doRunOnce();
      } else if (k === "d") {
        e.preventDefault();
        doDiscover();
      } else if (k === "a") {
        e.preventDefault();
        doToggleAuto();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doRunOnce, doDiscover, doToggleAuto]);

  // --- Generative-UI copilot actions ---
  useCopilotAction({
    name: "discoverPodcasts",
    description: "Discover trending podcasts for a topic and queue the best for clipping.",
    parameters: [
      { name: "topic", type: "string", description: "topic to search", required: true },
    ],
    handler: async ({ topic }) => {
      const out = await control("discover", { topic });
      bump();
      return out;
    },
    render: ({ status: s, args, result }) => (
      <Card className="my-1">
        <div className="flex items-center gap-2 pb-3">
          <Search size={14} className="text-neutral-500" />
          <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">
            Discovering “{args?.topic}”
          </span>
        </div>
        {s === "complete" ? (
          <div className="flex flex-col gap-2">
            <div className="font-mono text-[11px] text-neutral-500">
              Queued {result?.count ?? 0} candidates.
            </div>
            {(result?.items || []).slice(0, 5).map((it: any, i: number) => (
              <div
                key={i}
                className="flex items-center gap-3 border-t border-neutral-900 pt-2 text-xs"
              >
                <span className="font-mono text-emerald-400">
                  {(it.trend_score ?? 0).toFixed(2)}
                </span>
                <span className="flex-1 truncate text-neutral-300">{it.title}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <Loader2 size={12} className="animate-spin" />
            Searching YouTube + scoring against trend vectors…
          </div>
        )}
      </Card>
    ),
  });

  useCopilotAction({
    name: "researchTrends",
    description:
      "Use the browser-use web-research harness to find THIS WEEK's trending podcast " +
      "episodes for a topic, resolve them to real YouTube videos, score, and queue the best.",
    parameters: [
      { name: "topic", type: "string", description: "topic to research", required: true },
    ],
    handler: async ({ topic }) => {
      const out = await control("research", { topic });
      bump();
      return out;
    },
    render: ({ status: s, args, result }) => (
      <Card className="my-1">
        <div className="flex items-center gap-2 pb-3">
          <Globe size={14} className="text-neutral-500" />
          <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">
            Researching “{args?.topic}”
          </span>
        </div>
        {s === "complete" ? (
          <div className="flex flex-col gap-2">
            <div className="font-mono text-[11px] text-neutral-500">
              Queued {result?.count ?? 0} researched episodes.
            </div>
            {(result?.items || []).slice(0, 5).map((it: any, i: number) => (
              <div
                key={i}
                className="flex items-center gap-3 border-t border-neutral-900 pt-2 text-xs"
              >
                <span className="font-mono text-emerald-400">
                  {(it.trend_score ?? 0).toFixed(2)}
                </span>
                <span className="flex-1 truncate text-neutral-300">{it.title}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <Loader2 size={12} className="animate-spin" />
            Browsing the web for this week’s trending episodes…
          </div>
        )}
      </Card>
    ),
  });

  useCopilotAction({
    name: "runPipeline",
    description:
      "Run one full autonomous cycle: discover → score → clip → publish (sandbox). " +
      "Use this when asked to clip the most controversial/viral moments.",
    parameters: [
      { name: "topic", type: "string", description: "optional topic", required: false },
    ],
    handler: async ({ topic }) => {
      setBusy(true);
      const out = await control("run-once", topic ? { topic } : {});
      setBusy(false);
      bump();
      return out;
    },
    render: ({ status: s, result }) => (
      <Card className="my-1">
        <div className="flex items-center gap-2 pb-3">
          <Play size={14} className="text-neutral-500" />
          <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">
            Running pipeline
          </span>
          {s !== "complete" && (
            <Badge className="border-violet-900/60 text-violet-300">
              <Loader2 size={10} className="animate-spin" />
              working
            </Badge>
          )}
        </div>
        {s === "complete" ? (
          <div className="flex flex-col gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono text-neutral-300">{result?.job_id}</span>
              {result?.stage && <StagePill stage={result.stage as Stage} />}
            </div>
            <div className="text-neutral-500">
              “{result?.title}” · trend score{" "}
              <span className="font-mono text-neutral-300">{result?.trend_score}</span>
            </div>
            <div className="text-neutral-600">Watch it stream in Live Pipeline →</div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <Loader2 size={12} className="animate-spin" />
            discover → score → clip → reframe → caption → publish…
          </div>
        )}
      </Card>
    ),
  });

  useCopilotAction({
    name: "showAnalytics",
    description:
      "Show current performance analytics and the winning patterns learned so far.",
    parameters: [],
    handler: async () => {
      bump();
      return await fetch("/api/analytics").then((r) => r.json());
    },
    render: ({ status: s, result }) => (
      <Card className="my-1">
        <div className="flex items-center gap-2 pb-3">
          <BarChart3 size={14} className="text-neutral-500" />
          <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">
            Analytics
          </span>
        </div>
        {s === "complete" && result ? (
          <div className="flex flex-col gap-2 text-xs">
            <div className="font-mono text-neutral-300">
              {result.totals?.clips} clips · {result.totals?.views?.toLocaleString()} views
            </div>
            <div className="text-neutral-500">{result.patterns?.summary}</div>
            <div className="flex flex-wrap gap-1.5">
              {(result.patterns?.winning_topics || []).map((t: string) => (
                <Badge key={t}>
                  <Trophy size={10} className="text-neutral-500" />
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <Loader2 size={12} className="animate-spin" />
            Crunching engagement…
          </div>
        )}
      </Card>
    ),
  });

  useCopilotAction({
    name: "rateClipVirality",
    description:
      "Rate multiple clips with predicted virality scores, retention, and explain WHY each " +
      "clip would perform. Uses mock predictions until OpenShorts multi-clip output is wired.",
    parameters: [
      {
        name: "clip_id",
        type: "string",
        description: "optional clip id to focus on; omit for all clips ranked",
        required: false,
      },
    ],
    handler: async ({ clip_id }) => {
      const clips = getClipPredictions();
      if (clip_id) {
        const one = clips.find((c) => c.clip_id === clip_id);
        return one ?? { error: `unknown clip ${clip_id}` };
      }
      return { best: clips[0], clips };
    },
    render: ({ status: s, result }) => (
      <Card className="my-1">
        <div className="flex items-center gap-2 pb-3">
          <TrendingUp size={14} className="text-rose-400" />
          <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">
            Virality prediction
          </span>
        </div>
        {s === "complete" && result && !result.error ? (
          <div className="flex flex-col gap-2 text-xs">
            {"clips" in result && result.clips ? (
              <>
                <div className="font-mono text-emerald-400">
                  Best: {result.best?.title} · score {result.best?.virality_score}/100
                </div>
                <p className="text-neutral-500">{result.best?.reasoning}</p>
              </>
            ) : (
              <>
                <div className="font-mono text-neutral-300">
                  {result.title} · {result.virality_score}/100
                </div>
                <ul className="list-inside list-disc text-neutral-500">
                  {(result.why_bullets || []).slice(0, 3).map((b: string, i: number) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <Loader2 size={12} className="animate-spin" />
            Scoring clips…
          </div>
        )}
      </Card>
    ),
  });

  useCopilotAction({
    name: "explainWhyItWon",
    description:
      "Explain WHY the best-performing clip beat the weakest one and what the self-learning " +
      "loop auto-applied to future clips. Use when asked why a video did better, what " +
      "ClipPilot learned, or how it is improving itself over time.",
    parameters: [],
    handler: async () => {
      bump();
      return await fetch("/api/insights").then((r) => r.json());
    },
    render: ({ status: s, result }) => (
      <Card className="my-1">
        <div className="flex items-center gap-2 pb-3">
          <GraduationCap size={14} className="text-emerald-400" />
          <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">
            Self-learning
          </span>
        </div>
        {s === "complete" && result?.latest ? (
          <div className="flex flex-col gap-2 text-xs">
            <p className="leading-relaxed text-neutral-300">{result.latest.why}</p>
            <div className="flex flex-wrap gap-1.5">
              {(result.latest.applied || []).map((a: string, i: number) => (
                <Badge key={i} className="border-emerald-900/60 text-emerald-300">
                  <Check size={10} />
                  {a}
                </Badge>
              ))}
            </div>
          </div>
        ) : s === "complete" ? (
          <div className="text-xs text-neutral-500">
            No comparison yet — the loop needs 2+ scored clips. Run the pipeline a few times.
          </div>
        ) : (
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <Loader2 size={12} className="animate-spin" />
            Comparing winners vs losers…
          </div>
        )}
      </Card>
    ),
  });

  // --- Loop controls the copilot can invoke from chat ---
  useCopilotAction(
    {
      name: "startAutonomousLoop",
      description:
        "Start ClipPilot's unattended autonomous loop (discover → clip → post → learn → repeat) " +
        "on a topic. Renders an in-chat confirmation; the loop only starts after the user clicks " +
        "Confirm. Use this to start the loop rather than any lower-level start action.",
      parameters: [
        {
          name: "topic",
          type: "string",
          description: "topic to run on, e.g. 'AI' or 'business'",
          required: false,
        },
        {
          name: "interval_seconds",
          type: "number",
          description: "seconds between cycles (optional)",
          required: false,
        },
      ],
      renderAndWaitForResponse: ({ status: s, args, respond, result }) => (
        <ConfirmStartLoop
          status={s}
          args={args}
          respond={respond}
          result={result}
          defaultTopic={status?.topic ?? "tech"}
          onConfirm={async (topic, intervalSeconds) => {
            if (!ensureOrchestrator()) return { ok: false };
            const payload = intervalSeconds
              ? { topic, interval_seconds: intervalSeconds }
              : { topic };
            const r = await callControl("start", payload);
            if (r.ok) toast("Autonomous loop started", "success");
            else toast("Could not reach the orchestrator", "error");
            loadStatus();
            bump();
            return { ok: r.ok };
          }}
        />
      ),
    },
    [status?.topic, ensureOrchestrator, loadStatus, bump],
  );

  useCopilotAction(
    {
      name: "stopAutonomousLoop",
      description: "Stop ClipPilot's autonomous loop. Returns the updated orchestrator status.",
      parameters: [],
      handler: async () => {
        if (!ensureOrchestrator()) return { ok: false };
        const r = await callControl("stop", {});
        if (r.ok) toast("Autonomous loop stopped", "success");
        else toast("Could not reach the orchestrator", "error");
        loadStatus();
        bump();
        return r.data;
      },
      render: ({ status: s }) => (
        <Card className="my-1">
          <div className="flex items-center gap-2">
            {s === "complete" ? (
              <Square size={14} className="text-rose-400" />
            ) : (
              <Loader2 size={12} className="animate-spin text-neutral-500" />
            )}
            <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">
              {s === "complete" ? "Autonomous loop stopped" : "Stopping loop…"}
            </span>
          </div>
        </Card>
      ),
    },
    [ensureOrchestrator, loadStatus, bump],
  );

  useCopilotAction(
    {
      name: "setTopic",
      description:
        "Change ClipPilot's active working topic. If the autonomous loop is running it re-points " +
        "the loop to the new topic; otherwise it seeds discovery for the new topic.",
      parameters: [
        {
          name: "topic",
          type: "string",
          description: "the new topic, e.g. 'AI podcasts'",
          required: true,
        },
      ],
      handler: async ({ topic }) => {
        if (!ensureOrchestrator()) return { ok: false };
        const action = running ? "start" : "discover";
        const r = await callControl(action, { topic });
        if (r.ok) toast(`Topic set to “${topic}”`, "success");
        else toast("Could not reach the orchestrator", "error");
        loadStatus();
        bump();
        return { topic, applied_via: action, ok: r.ok, ...r.data };
      },
      render: ({ status: s, args, result }) => (
        <Card className="my-1">
          <div className="flex items-center gap-2 pb-2">
            <Hash size={14} className="text-amber-400" />
            <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">
              {s === "complete" ? "Topic updated" : "Updating topic"}
            </span>
          </div>
          {s === "complete" ? (
            <div className="font-mono text-[11px] text-neutral-500">
              now tracking “{result?.topic ?? args?.topic}”
              {result?.applied_via === "start" ? " · loop re-pointed" : " · discovery seeded"}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-neutral-500">
              <Loader2 size={12} className="animate-spin" />
              switching to “{args?.topic}”…
            </div>
          )}
        </Card>
      ),
    },
    [running, ensureOrchestrator, loadStatus, bump],
  );

  const activeLabel = NAV_ITEMS.find((n) => n.id === activeSection)?.label ?? "Overview";

  return (
    <>
      <ScrollProgress containerRef={contentRef} />
      <CommandMenu
        running={!!running}
        onRunOnce={doRunOnce}
        onDiscover={doDiscover}
        onToggleAuto={doToggleAuto}
        onNavigate={navigate}
      />

      <motion.div
        ref={contentRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex h-screen min-w-0 flex-1 flex-col overflow-y-auto"
      >
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-neutral-900 bg-black/50 px-6 backdrop-blur-md">
          <Aurora />
          <div className="flex min-w-0 flex-col leading-tight">
            <h1 className="text-sm font-semibold tracking-tight text-neutral-100">
              {activeLabel}
            </h1>
            <span className="truncate text-[11px] text-neutral-500">
              autonomous podcast → shorts factory
            </span>
          </div>

          <div className="flex items-center gap-2">
            <YouTubeConnect />

            <Tooltip label="Discover podcasts" hotkey="D">
              <MagneticButton variant="ghost" disabled={busy} onClick={doDiscover}>
                <Search size={14} />
                Discover
              </MagneticButton>
            </Tooltip>
            <Tooltip label="Research trending episodes">
              <MagneticButton variant="ghost" disabled={busy} onClick={doResearch}>
                <Globe size={14} />
                Research
              </MagneticButton>
            </Tooltip>
            <Tooltip label="Run one cycle" hotkey="R">
              <MagneticButton variant="primary" disabled={busy} onClick={doRunOnce}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                {busy ? "Running" : "Run Once"}
              </MagneticButton>
            </Tooltip>
            {running ? (
              <Tooltip label="Stop autonomous loop" hotkey="A">
                <MagneticButton variant="danger" onClick={doToggleAuto}>
                  <Square size={14} />
                  Stop Auto
                </MagneticButton>
              </Tooltip>
            ) : (
              <Tooltip label="Start autonomous loop" hotkey="A">
                <MagneticButton variant="ghost" onClick={doToggleAuto}>
                  <Power size={14} />
                  Start Auto
                </MagneticButton>
              </Tooltip>
            )}
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-6 py-6">
          {activeSection === "overview" && (
            <>
              <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Reveal delay={0}>
                  <GlowMetricCard
                    title="Status"
                    variant="red"
                    dot
                    pulse={!!running}
                    value={
                      <span className={running ? "text-neutral-100" : "text-rose-400/90"}>
                        {running ? "ON" : "OFF"}
                      </span>
                    }
                    description="autonomous loop"
                  />
                </Reveal>
                <Reveal delay={0.06}>
                  <GlowMetricCard
                    title="Cycles Run"
                    variant="blue"
                    icon={Repeat}
                    value={<OdometerNumber value={Number(status?.cycles ?? 0)} />}
                    description="total"
                    sparkline={cyclesHist}
                  />
                </Reveal>
                <Reveal delay={0.12}>
                  <GlowMetricCard
                    title="Queue Pending"
                    variant="cyan"
                    icon={ListVideo}
                    value={<OdometerNumber value={Number(status?.queue_pending ?? 0)} />}
                    description="candidates"
                    sparkline={queueHist}
                  />
                </Reveal>
                <Reveal delay={0.18}>
                  <GlowMetricCard
                    title="Current Topic"
                    variant="amber"
                    icon={Hash}
                    value={
                      <span
                        className={`truncate text-base ${
                          status?.topic ? "text-amber-400/90" : "text-neutral-100"
                        }`}
                      >
                        {status?.topic ?? "—"}
                      </span>
                    }
                  />
                </Reveal>
              </section>
              <Reveal>
                <LivePipeline />
              </Reveal>
            </>
          )}

          {activeSection === "live-pipeline" && (
            <Reveal>
              <LivePipeline />
            </Reveal>
          )}

          {activeSection === "editing-studio" && (
            <Reveal>
              <MockEditingStudio />
            </Reveal>
          )}

          {activeSection === "virality-predictor" && (
            <Reveal>
              <ViralityPredictor />
            </Reveal>
          )}

          {activeSection === "viral-moments" && (
            <>
              <Reveal>
                <ClipsGallery refreshKey={refreshKey} />
              </Reveal>
              <Reveal>
                <RecentClipHistory refreshKey={refreshKey} />
              </Reveal>
              <Reveal>
                <Analytics refreshKey={refreshKey} />
              </Reveal>
            </>
          )}

          {activeSection === "self-learning" && (
            <Reveal>
              <SelfLearning refreshKey={refreshKey} />
            </Reveal>
          )}

          {activeSection === "discovered-queue" && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[0.9fr_1.1fr]">
              <Reveal>
                <ManualUpload />
              </Reveal>
              <Reveal>
                <DiscoveredQueue refreshKey={refreshKey} />
              </Reveal>
            </div>
          )}
        </main>

        <ActivityTicker />
      </motion.div>
    </>
  );
}
