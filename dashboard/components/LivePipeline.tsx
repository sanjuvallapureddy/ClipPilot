"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Radio } from "lucide-react";
import type { JobEvent } from "@/lib/types";
import {
  estimateFetchingSeconds,
  fetchingEtaLabel,
} from "@/lib/fetchingEta";
import { SectionCard, StagePill } from "@/components/ui";

const terminalStages = new Set(["done", "failed"]);

function fetchStartMs(
  cache: Record<string, number>,
  jobId: string,
  ts: number,
): number {
  if (!cache[jobId]) cache[jobId] = ts * 1000;
  return cache[jobId];
}

function FetchingProgressBar({
  message,
  startedAt,
  now,
}: {
  message: string;
  startedAt: number;
  now: number;
}) {
  const estimateSec = estimateFetchingSeconds(message);
  const elapsedSec = Math.max(0, (now - startedAt) / 1000);
  const { elapsed, remaining, pct } = fetchingEtaLabel(elapsedSec, estimateSec);

  return (
    <div className="col-span-full -mt-0.5 mb-1 space-y-1.5 pl-[calc(4.5rem+0.75rem)] pr-1">
      <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
        <span className="text-sky-300/90">Fetching</span>
        <span className="text-neutral-500">{remaining}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-2 flex-1 overflow-hidden rounded-sm bg-neutral-900 ring-1 ring-neutral-800">
          <div
            className="h-full rounded-sm bg-gradient-to-r from-sky-600 to-sky-400 transition-[width] duration-1000 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="w-8 shrink-0 text-right font-mono text-[10px] tabular-nums text-sky-400">
          {pct}%
        </span>
      </div>
      <div className="flex flex-wrap gap-x-2 font-mono text-[10px] text-neutral-600">
        <span>{elapsed} elapsed</span>
        <span>·</span>
        <span>~{formatMinutes(estimateSec)} est. total</span>
      </div>
    </div>
  );
}

function formatMinutes(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return `${m}m`;
}

export default function LivePipeline() {
  // A job is a state machine — it is only ever in ONE stage at a time. `jobs:stream` is an
  // append-only log of every transition, so we collapse it by job_id and keep each job's
  // LATEST event. Rendering raw events made a single job (queued→fetching→analyzing) look
  // like multiple stages running concurrently.
  const [jobs, setJobs] = useState<Record<string, JobEvent>>({});
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const fetchStarts = useRef<Record<string, number>>({});

  useEffect(() => {
    const es = new EventSource("/api/jobs/stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("job", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as JobEvent;
      if (!data.job_id) return;
      setJobs((prev) => {
        const existing = prev[data.job_id];
        if (existing && terminalStages.has(existing.stage) && !terminalStages.has(data.stage)) {
          return prev;
        }
        if (existing && existing.ts > data.ts) return prev; // ignore stale/out-of-order
        return { ...prev, [data.job_id]: data };
      });
    });
    return () => es.close();
  }, []);

  useEffect(() => {
    const hasFetching = Object.values(jobs).some((j) => j.stage === "fetching");
    if (!hasFetching) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [jobs]);

  useEffect(() => {
    const active = new Set(
      Object.values(jobs)
        .filter((j) => j.stage === "fetching")
        .map((j) => j.job_id),
    );
    for (const id of Object.keys(fetchStarts.current)) {
      if (!active.has(id)) delete fetchStarts.current[id];
    }
  }, [jobs]);

  const rows = useMemo(
    () => Object.values(jobs).sort((a, b) => b.ts - a.ts).slice(0, 50),
    [jobs],
  );

  return (
    <SectionCard
      title="Live Pipeline"
      icon={Radio}
      right={
        <div className="flex items-center gap-2">
          <span className="relative flex h-1.5 w-1.5">
            {connected && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            )}
            <span
              className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                connected ? "bg-emerald-400" : "bg-red-500"
              }`}
            />
          </span>
          <span className="font-mono text-[10px] text-neutral-500">
            {connected ? "streaming jobs:stream" : "disconnected"}
          </span>
        </div>
      }
    >
      <div className="max-h-80 overflow-y-auto">
        {rows.length === 0 && (
          <div className="py-6 text-center font-mono text-xs text-neutral-600">
            Waiting for job events… run the pipeline.
          </div>
        )}
        <div className="flex flex-col">
          {rows.map((ev) => (
            <div
              key={ev.job_id}
              className="grid grid-cols-[auto_1fr] border-b border-neutral-900/70 py-2 text-xs last:border-b-0"
            >
              <div className="col-span-full flex items-center gap-3">
                <StagePill stage={ev.stage} />
                <span className="flex-1 truncate text-neutral-300">
                  {ev.title || ev.job_id}
                </span>
                <span className="hidden truncate font-mono text-[11px] text-neutral-600 sm:block">
                  {ev.message}
                </span>
              </div>
              {ev.stage === "fetching" && (
                <FetchingProgressBar
                  message={ev.message}
                  startedAt={fetchStartMs(fetchStarts.current, ev.job_id, ev.ts)}
                  now={now}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}
