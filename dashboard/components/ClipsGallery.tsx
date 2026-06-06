"use client";
import { useEffect, useState } from "react";
import type { ClipResult } from "@/lib/types";

const ICON: Record<string, string> = { tiktok: "🎵", instagram: "📸", youtube: "▶️" };

export default function ClipsGallery({ refreshKey }: { refreshKey: number }) {
  const [clips, setClips] = useState<ClipResult[]>([]);

  useEffect(() => {
    let on = true;
    const load = () =>
      fetch("/api/clips")
        .then((r) => r.json())
        .then((d) => on && setClips(d.clips || []))
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [refreshKey]);

  return (
    <div className="panel">
      <h2>Clips Gallery ({clips.length})</h2>
      {clips.length === 0 && <div className="muted">No published clips yet.</div>}
      <div className="clips">
        {clips.map((c) => (
          <div className="clip" key={c.clip_id}>
            <div className="thumb">{ICON[c.platform] || "🎬"}</div>
            <div className="t">{c.title}</div>
            <div className="meta">
              <span className={`pill ${c.post_id ? "done" : "queued"}`}>
                {c.post_id ? "posted" : "pending"}
              </span>
              <span>{c.views.toLocaleString()} views</span>
            </div>
            <div className="meta">
              <span>♥ {c.likes.toLocaleString()}</span>
              <span>↗ {c.shares.toLocaleString()}</span>
              <span className="score">{c.engagement_score.toFixed(3)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
