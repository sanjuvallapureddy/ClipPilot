"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
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
} from "lucide-react";
import { getClipPredictions } from "@/lib/virality-mock";
import LivePipeline from "@/components/LivePipeline";
import DiscoveredQueue from "@/components/DiscoveredQueue";
import ClipsGallery from "@/components/ClipsGallery";
import Analytics from "@/components/Analytics";
import ActivityTicker from "@/components/ActivityTicker";
import CommandMenu from "@/components/CommandMenu";
import YouTubeConnect from "@/components/YouTubeConnect";
import ManualUpload from "@/components/ManualUpload";
import MockEditingStudio from "@/components/MockEditingStudio";
import ViralityPredictor from "@/components/ViralityPredictor";
import Sidebar, { NAV_ITEMS } from "@/components/Sidebar";
import Aurora from "@/components/Aurora";
import ScrollProgress from "@/components/ScrollProgress";
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

export default function Page() {
  const [status, setStatus] = useState<any>(null);
  const [online, setOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [cyclesHist, setCyclesHist] = useState<number[]>([]);
  const [queueHist, setQueueHist] = useState<number[]>([]);
  const [activeSection, setActiveSection] = useState("overview");
  const contentRef = useRef<HTMLDivElement>(null);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Scroll within the inner content panel (reliable regardless of CopilotKit's wrapper).
  const navigate = useCallback((id: string) => {
    const el = document.getElementById(id);
    const container = contentRef.current;
    if (!el) return;
    if (container) {
      const top =
        el.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop -
        56; // 56px = sticky header height
      container.scrollTo({ top, behavior: "smooth" });
    } else {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // Section spy — watch the same scroll container.
  useEffect(() => {
    const container = contentRef.current;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setActiveSection(e.target.id || "overview");
        });
      },
      { root: container ?? null, rootMargin: "-30% 0px -55% 0px", threshold: 0 },
    );
    NAV_ITEMS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

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

  useCopilotReadable({
    description:
      "ClipPilot orchestrator status, queue depth, and current winning patterns",
    value: status,
  });

  const running = status?.running;

  // --- Control actions with toast feedback ---
  const doDiscover = useCallback(async () => {
    if (busy) return;
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
  }, [busy, status?.topic, bump]);

  const doResearch = useCallback(async () => {
    if (busy) return;
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
  }, [busy, status?.topic, bump]);

  const doRunOnce = useCallback(async () => {
    if (busy) return;
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
  }, [busy, bump]);

  const doToggleAuto = useCallback(async () => {
    const turningOn = !running;
    const { ok } = await callControl(turningOn ? "start" : "stop", {
      topic: status?.topic || "tech",
    });
    if (ok) toast(turningOn ? "Autonomous loop started" : "Autonomous loop stopped", "success");
    else toast("Could not reach the orchestrator", "error");
    loadStatus();
  }, [running, status?.topic, loadStatus]);

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

  const activeLabel = NAV_ITEMS.find((n) => n.id === activeSection)?.label ?? "Overview";

  return (
    <div className="flex min-h-screen bg-black">
      <ScrollProgress containerRef={contentRef} />
      <CommandMenu
        running={!!running}
        onRunOnce={doRunOnce}
        onDiscover={doDiscover}
        onToggleAuto={doToggleAuto}
      />

      <Sidebar active={activeSection} online={online} onNavigate={navigate} />

      <div ref={contentRef} className="flex h-screen min-w-0 flex-1 flex-col overflow-y-auto">
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
          <section id="overview" className="grid scroll-mt-20 grid-cols-2 gap-3 lg:grid-cols-4">
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

        <Reveal id="live-pipeline" className="scroll-mt-20">
          <LivePipeline />
        </Reveal>

        <Reveal id="editing-studio" className="scroll-mt-20">
          <MockEditingStudio />
        </Reveal>

        <Reveal id="virality-predictor" className="scroll-mt-20">
          <ViralityPredictor />
        </Reveal>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col gap-4">
            <Reveal id="viral-moments" className="scroll-mt-20">
              <ClipsGallery refreshKey={refreshKey} />
            </Reveal>
            <Reveal id="analytics" className="scroll-mt-20">
              <Analytics refreshKey={refreshKey} />
            </Reveal>
          </div>
          <div className="flex flex-col gap-4">
            <Reveal className="scroll-mt-20">
              <ManualUpload />
            </Reveal>
            <Reveal id="discovered-queue" className="scroll-mt-20">
              <DiscoveredQueue refreshKey={refreshKey} />
            </Reveal>
          </div>
        </section>
        </main>

        <ActivityTicker />
      </div>
    </div>
  );
}
