"use client";
import { useCallback, useEffect, useState } from "react";
import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import LivePipeline from "@/components/LivePipeline";
import DiscoveredQueue from "@/components/DiscoveredQueue";
import ClipsGallery from "@/components/ClipsGallery";
import Analytics from "@/components/Analytics";

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
    description: "ClipPilot orchestrator status, queue depth, and current winning patterns",
    value: status,
  });

  // --- Generative-UI copilot actions ---
  useCopilotAction({
    name: "discoverPodcasts",
    description: "Discover trending podcasts for a topic and queue the best for clipping.",
    parameters: [{ name: "topic", type: "string", description: "topic to search", required: true }],
    handler: async ({ topic }) => {
      const out = await control("discover", { topic });
      bump();
      return out;
    },
    render: ({ status: s, args, result }) => (
      <div className="panel" style={{ margin: 0 }}>
        <h2>🔎 Discovering “{args?.topic}”</h2>
        {s === "complete" ? (
          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Queued {result?.count ?? 0} candidates.
            </div>
            {(result?.items || []).slice(0, 5).map((it: any, i: number) => (
              <div className="qitem" key={i}>
                <span className="score">{(it.trend_score ?? 0).toFixed(2)}</span>
                <span className="evt-title">{it.title}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">Searching YouTube + scoring against trend vectors…</div>
        )}
      </div>
    ),
  });

  useCopilotAction({
    name: "runPipeline",
    description:
      "Run one full autonomous cycle: discover → score → clip → publish (sandbox). " +
      "Use this when asked to clip the most controversial/viral moments.",
    parameters: [{ name: "topic", type: "string", description: "optional topic", required: false }],
    handler: async ({ topic }) => {
      setBusy(true);
      const out = await control("run-once", topic ? { topic } : {});
      setBusy(false);
      bump();
      return out;
    },
    render: ({ status: s, result }) => (
      <div className="panel" style={{ margin: 0 }}>
        <h2>🚀 Running pipeline {s !== "complete" && <span className="pill rendering">working…</span>}</h2>
        {s === "complete" ? (
          <div style={{ fontSize: 13 }}>
            <div>
              Job <b>{result?.job_id}</b> → <span className={`pill ${result?.stage}`}>{result?.stage}</span>
            </div>
            <div className="muted" style={{ marginTop: 4 }}>
              “{result?.title}” · trend score {result?.trend_score}
            </div>
            <div className="muted" style={{ marginTop: 4 }}>Watch it stream in Live Pipeline →</div>
          </div>
        ) : (
          <div className="muted">discover → score → clip → reframe → caption → publish…</div>
        )}
      </div>
    ),
  });

  useCopilotAction({
    name: "showAnalytics",
    description: "Show current performance analytics and the winning patterns learned so far.",
    parameters: [],
    handler: async () => {
      bump();
      return (await fetch("/api/analytics").then((r) => r.json()));
    },
    render: ({ status: s, result }) => (
      <div className="panel" style={{ margin: 0 }}>
        <h2>📊 Analytics</h2>
        {s === "complete" && result ? (
          <div style={{ fontSize: 13 }}>
            <div>{result.totals?.clips} clips · {result.totals?.views?.toLocaleString()} views</div>
            <div className="muted" style={{ marginTop: 6 }}>{result.patterns?.summary}</div>
            <div style={{ marginTop: 6 }}>
              {(result.patterns?.winning_topics || []).map((t: string) => (
                <span className="tag" key={t}>🏆 {t}</span>
              ))}
            </div>
          </div>
        ) : (
          <div className="muted">Crunching engagement…</div>
        )}
      </div>
    ),
  });

  const running = status?.running;

  return (
    <div className="wrap">
      <div className="topbar">
        <div className="brand">
          <div className="logo">🎬</div>
          <div>
            <h1>ClipPilot — Mission Control</h1>
            <div className="sub">autonomous podcast → shorts factory</div>
          </div>
        </div>
        <div className="controls">
          <button className="btn ghost" disabled={busy} onClick={async () => { setBusy(true); await control("discover", { topic: status?.topic || "tech" }); setBusy(false); bump(); }}>
            Discover
          </button>
          <button className="btn" disabled={busy} onClick={async () => { setBusy(true); await control("run-once", {}); setBusy(false); bump(); }}>
            {busy ? "Running…" : "Run Once"}
          </button>
          {running ? (
            <button className="btn danger" onClick={async () => { await control("stop"); loadStatus(); }}>Stop Auto</button>
          ) : (
            <button className="btn" onClick={async () => { await control("start", { topic: status?.topic || "tech" }); loadStatus(); }}>Start Auto</button>
          )}
        </div>
      </div>

      <div className="stat-row">
        <div className="stat"><div className="n">{running ? "🟢 ON" : "⚪️ OFF"}</div><div className="l">autonomous loop</div></div>
        <div className="stat"><div className="n">{status?.cycles ?? 0}</div><div className="l">cycles run</div></div>
        <div className="stat"><div className="n">{status?.queue_pending ?? 0}</div><div className="l">queue pending</div></div>
        <div className="stat"><div className="n">{status?.topic ?? "—"}</div><div className="l">current topic</div></div>
      </div>

      <LivePipeline />

      <div className="grid">
        <div>
          <ClipsGallery refreshKey={refreshKey} />
          <Analytics refreshKey={refreshKey} />
        </div>
        <div>
          <DiscoveredQueue refreshKey={refreshKey} />
        </div>
      </div>
    </div>
  );
}
