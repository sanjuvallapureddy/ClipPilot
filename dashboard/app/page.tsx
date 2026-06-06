"use client";
import { useCallback, useEffect, useState } from "react";
import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import {
  Clapperboard,
  Search,
  Play,
  Square,
  Power,
  Repeat,
  ListVideo,
  Hash,
  Loader2,
  BarChart3,
  Trophy,
  Command as CommandIcon,
} from "lucide-react";
import LivePipeline from "@/components/LivePipeline";
import DiscoveredQueue from "@/components/DiscoveredQueue";
import ClipsGallery from "@/components/ClipsGallery";
import Analytics from "@/components/Analytics";
import ActivityTicker from "@/components/ActivityTicker";
import CommandMenu, { openCommandMenu } from "@/components/CommandMenu";
import YouTubeConnect from "@/components/YouTubeConnect";
import {
  Button,
  Card,
  GlowMetricCard,
  Badge,
  StagePill,
  Tooltip,
  AnimatedNumber,
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
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

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

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <CommandMenu
        running={!!running}
        onRunOnce={doRunOnce}
        onDiscover={doDiscover}
        onToggleAuto={doToggleAuto}
      />

      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-neutral-900 bg-black/50 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950">
            <Clapperboard size={16} className="text-neutral-100" />
          </div>
          <div className="flex flex-col leading-tight">
            <h1 className="text-sm font-semibold tracking-tight text-neutral-100">
              ClipPilot
              <span className="ml-2 text-neutral-600">Mission Control</span>
            </h1>
            <span className="text-[11px] text-neutral-500">
              autonomous podcast → shorts factory
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <HealthChip online={online} />

          <Tooltip label="Command menu" hotkey="⌘K">
            <button
              onClick={openCommandMenu}
              className="hidden items-center gap-1.5 rounded-md border border-neutral-900 bg-transparent px-2 py-1.5 text-neutral-500 transition-colors hover:border-neutral-800 hover:text-neutral-300 sm:flex"
            >
              <CommandIcon size={13} />
              <span className="font-mono text-[11px]">K</span>
            </button>
          </Tooltip>

          <div className="mx-1 hidden h-5 w-px bg-neutral-900 sm:block" />

          <YouTubeConnect />

          <Tooltip label="Discover podcasts" hotkey="D">
            <Button variant="ghost" disabled={busy} onClick={doDiscover}>
              <Search size={14} />
              Discover
            </Button>
          </Tooltip>
          <Tooltip label="Run one cycle" hotkey="R">
            <Button variant="primary" disabled={busy} onClick={doRunOnce}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {busy ? "Running" : "Run Once"}
            </Button>
          </Tooltip>
          {running ? (
            <Tooltip label="Stop autonomous loop" hotkey="A">
              <Button variant="danger" onClick={doToggleAuto}>
                <Square size={14} />
                Stop Auto
              </Button>
            </Tooltip>
          ) : (
            <Tooltip label="Start autonomous loop" hotkey="A">
              <Button variant="ghost" onClick={doToggleAuto}>
                <Power size={14} />
                Start Auto
              </Button>
            </Tooltip>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-6 py-6">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
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
          <GlowMetricCard
            title="Cycles Run"
            variant="blue"
            icon={Repeat}
            value={<AnimatedNumber value={Number(status?.cycles ?? 0)} />}
            description="total"
            sparkline={cyclesHist}
          />
          <GlowMetricCard
            title="Queue Pending"
            variant="cyan"
            icon={ListVideo}
            value={<AnimatedNumber value={Number(status?.queue_pending ?? 0)} />}
            description="candidates"
            sparkline={queueHist}
          />
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
        </section>

        <div id="live-pipeline" className="scroll-mt-20">
          <LivePipeline />
        </div>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col gap-4">
            <div id="viral-moments" className="scroll-mt-20">
              <ClipsGallery refreshKey={refreshKey} />
            </div>
            <div id="analytics" className="scroll-mt-20">
              <Analytics refreshKey={refreshKey} />
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <div id="discovered-queue" className="scroll-mt-20">
              <DiscoveredQueue refreshKey={refreshKey} />
            </div>
          </div>
        </section>
      </main>

      <ActivityTicker />
    </div>
  );
}

function HealthChip({ online }: { online: boolean | null }) {
  const label =
    online === null ? "connecting" : online ? "orchestrator" : "orchestrator offline";
  const dotCls =
    online === null ? "bg-neutral-600" : online ? "bg-emerald-400" : "bg-rose-500";
  const textCls =
    online === null ? "text-neutral-500" : online ? "text-neutral-400" : "text-rose-400/90";
  return (
    <Tooltip
      label={
        online ? "Lane A orchestrator reachable" : "Lane A unreachable — start the orchestrator"
      }
    >
      <div className="hidden items-center gap-1.5 rounded-md border border-neutral-900 px-2 py-1.5 sm:flex">
        <span className="relative flex h-1.5 w-1.5">
          {online && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          )}
          <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${dotCls}`} />
        </span>
        <span className={`font-mono text-[10px] uppercase tracking-wide ${textCls}`}>
          {label}
        </span>
      </div>
    </Tooltip>
  );
}
