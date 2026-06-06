"use client";
import { useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import type { JobEvent } from "@/lib/types";
import { SectionCard, StagePill } from "@/components/ui";

export default function LivePipeline() {
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource("/api/jobs/stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("job", (e) => {
      const data = JSON.parse((e as MessageEvent).data) as JobEvent;
      setEvents((prev) => [...prev.slice(-80), data]);
    });
    return () => es.close();
  }, []);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
  }, [events]);

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
      <div ref={ref} className="max-h-80 overflow-y-auto">
        {events.length === 0 && (
          <div className="py-6 text-center font-mono text-xs text-neutral-600">
            Waiting for job events… run the pipeline.
          </div>
        )}
        <div className="flex flex-col">
          {events.map((ev, i) => (
            <div
              key={`${ev.job_id}-${ev.ts}-${i}`}
              className="flex items-center gap-3 border-b border-neutral-900/70 py-2 text-xs last:border-b-0"
            >
              <StagePill stage={ev.stage} />
              <span className="flex-1 truncate text-neutral-300">
                {ev.title || ev.job_id}
              </span>
              <span className="hidden truncate font-mono text-[11px] text-neutral-600 sm:block">
                {ev.message}
              </span>
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}
