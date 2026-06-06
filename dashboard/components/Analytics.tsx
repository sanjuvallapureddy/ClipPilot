"use client";
import { useEffect, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Patterns } from "@/lib/types";

interface AnalyticsData {
  timeline: { posted_at: string; engagement: number; views: number }[];
  topicStats: { topic: string; avg_engagement: number; views: number; clips: number }[];
  patterns: Patterns | null;
  totals: { clips: number; views: number };
}

export default function Analytics({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<AnalyticsData | null>(null);

  useEffect(() => {
    let on = true;
    const load = () =>
      fetch("/api/analytics")
        .then((r) => r.json())
        .then((d) => on && setData(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [refreshKey]);

  if (!data) return <div className="panel"><h2>Analytics</h2><div className="muted">Loading…</div></div>;

  const series = data.timeline.map((p, i) => ({ i, engagement: +p.engagement.toFixed(3), views: p.views }));

  return (
    <div className="panel">
      <h2>Analytics — Engagement & Winning Patterns</h2>
      <div className="stat-row">
        <div className="stat"><div className="n">{data.totals.clips}</div><div className="l">clips</div></div>
        <div className="stat"><div className="n">{data.totals.views.toLocaleString()}</div><div className="l">total views</div></div>
        <div className="stat"><div className="n">{data.topicStats.length}</div><div className="l">topics tracked</div></div>
      </div>

      <div style={{ height: 160, marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series}>
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c5cff" stopOpacity={0.7} />
                <stop offset="100%" stopColor="#7c5cff" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="i" hide />
            <YAxis hide />
            <Tooltip contentStyle={{ background: "#14161f", border: "1px solid #272a3a", borderRadius: 8 }} />
            <Area type="monotone" dataKey="engagement" stroke="#7c5cff" fill="url(#g)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <h2 style={{ marginTop: 8 }}>Top Topics</h2>
      {data.topicStats.slice(0, 5).map((t) => (
        <div key={t.topic} style={{ marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
            <span>{t.topic}</span>
            <span className="score">{t.avg_engagement.toFixed(3)}</span>
          </div>
          <div className="bar">
            <span style={{ width: `${Math.min(100, t.avg_engagement * 100)}%` }} />
          </div>
        </div>
      ))}

      {data.patterns && (
        <div style={{ marginTop: 14, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <h2>Learned Patterns (Lane B → Lane A)</h2>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{data.patterns.summary}</div>
          <div>
            {data.patterns.winning_topics?.map((t) => <span className="tag" key={t}>🏆 {t}</span>)}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            ideal length {data.patterns.ideal_length_min}–{data.patterns.ideal_length_max}s ·
            caption: {data.patterns.caption_style}
          </div>
        </div>
      )}
    </div>
  );
}
