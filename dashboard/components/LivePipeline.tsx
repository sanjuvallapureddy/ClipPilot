"use client";
import { useEffect, useRef, useState } from "react";
import type { JobEvent } from "@/lib/types";

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
    <div className="panel">
      <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        Live Pipeline
        <span className={`live-dot ${connected ? "pulsing" : ""}`} style={{ background: connected ? "var(--accent-2)" : "var(--danger)" }} />
        <span className="muted" style={{ fontSize: 11, textTransform: "none", letterSpacing: 0 }}>
          {connected ? "streaming jobs:stream" : "disconnected"}
        </span>
      </h2>
      <div ref={ref} style={{ maxHeight: 320, overflowY: "auto" }}>
        {events.length === 0 && <div className="muted">Waiting for job events… run the pipeline.</div>}
        {events.map((ev, i) => (
          <div className="event" key={`${ev.job_id}-${ev.ts}-${i}`}>
            <span className={`pill ${ev.stage}`}>{ev.stage}</span>
            <span className="evt-title">{ev.title || ev.job_id}</span>
            <span className="evt-msg">{ev.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
