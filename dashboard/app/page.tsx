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
} from "lucide-react";
import LivePipeline from "@/components/LivePipeline";
import DiscoveredQueue from "@/components/DiscoveredQueue";
import ClipsGallery from "@/components/ClipsGallery";
import Analytics from "@/components/Analytics";
import YouTubeConnect from "@/components/YouTubeConnect";
import ManualUpload from "@/components/ManualUpload";
import { Button, Card, GlowMetricCard, Badge, StagePill } from "@/components/ui";
import type { Stage } from "@/lib/types";

async function control(action: string, payload: unknown = {}) {
  const res = await fetch("/api/control", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  return res.json();
}

export default function Page() {
  const [status, setStatus] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  const loadStatus = useCallback(async () => {
    try {
      const r = await fetch("/api/control");
      setStatus(await r.json());
    } catch {
      /* Lane A may be down */
    }
  }, []);

  useEffect(() => {
    loadStatus();
    const t = setInterval(loadStatus, 4000);
    return () => clearInterval(t);
  }, [loadStatus]);

  // Expose live state to the copilot so it can reason about the pipeline.
  useCopilotReadable({
    description:
      "ClipPilot orchestrator status, queue depth, and current winning patterns",
    value: status,
  });

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

  const running = status?.running;

  return (
    <div className="min-h-screen bg-black">
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
          <YouTubeConnect />
          <Button
            variant="ghost"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await control("discover", { topic: status?.topic || "tech" });
              setBusy(false);
              bump();
            }}
          >
            <Search size={14} />
            Discover
          </Button>
          <Button
            variant="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await control("run-once", {});
              setBusy(false);
              bump();
            }}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {busy ? "Running" : "Run Once"}
          </Button>
          {running ? (
            <Button
              variant="danger"
              onClick={async () => {
                await control("stop");
                loadStatus();
              }}
            >
              <Square size={14} />
              Stop Auto
            </Button>
          ) : (
            <Button
              variant="ghost"
              onClick={async () => {
                await control("start", { topic: status?.topic || "tech" });
                loadStatus();
              }}
            >
              <Power size={14} />
              Start Auto
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6">
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <GlowMetricCard
            title="Status"
            variant="red"
            dot
            pulse={running}
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
            value={status?.cycles ?? 0}
            description="total"
          />
          <GlowMetricCard
            title="Queue Pending"
            variant="cyan"
            icon={ListVideo}
            value={status?.queue_pending ?? 0}
            description="candidates"
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

        <LivePipeline />

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col gap-4">
            <ClipsGallery refreshKey={refreshKey} />
            <Analytics refreshKey={refreshKey} />
          </div>
          <div className="flex flex-col gap-4">
            <ManualUpload />
            <DiscoveredQueue refreshKey={refreshKey} />
          </div>
        </section>
      </main>
    </div>
  );
}
