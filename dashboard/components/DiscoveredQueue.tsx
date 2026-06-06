"use client";
import { useEffect, useState } from "react";
import type { DiscoveryItem } from "@/lib/types";

export default function DiscoveredQueue({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<(DiscoveryItem & { id: string })[]>([]);

  useEffect(() => {
    let on = true;
    const load = () =>
      fetch("/api/queue")
        .then((r) => r.json())
        .then((d) => on && setItems(d.items || []))
        .catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [refreshKey]);

  return (
    <div className="panel">
      <h2>Discovered Queue ({items.length})</h2>
      {items.length === 0 && <div className="muted">No candidates yet — ask the copilot to discover.</div>}
      {items.map((it) => (
        <div className="qitem" key={it.id}>
          <span className="score">{(it.trend_score ?? 0).toFixed(2)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="evt-title">{it.title}</div>
            <div className="muted" style={{ fontSize: 11 }}>
              {it.podcast} · {it.topic}
            </div>
          </div>
          <span className="tag">{it.source}</span>
        </div>
      ))}
    </div>
  );
}
