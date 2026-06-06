"use client";
import { useEffect, useState } from "react";
import type { ClipResult } from "@/lib/types";

function ts(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

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
      <h2>Detected Viral Moments ({clips.length})</h2>
      {clips.length === 0 && (
        <div className="muted">
          No moments yet. Run the pipeline on a real episode — moments are detected from the
          real transcript by GPT.
        </div>
      )}
      <div className="moments">
        {clips.map((c) => (
          <div className="moment" key={c.clip_id}>
            <div className="moment-head">
              <span className="score">{c.engagement_score.toFixed(2)}</span>
              <span className="moment-hook">{c.hook}</span>
            </div>
            {c.quote && <div className="moment-quote">“{c.quote}”</div>}
            {c.reason && <div className="muted moment-reason">{c.reason}</div>}
            <div className="moment-meta">
              {c.topic && <span className="tag">{c.topic}</span>}
              <span className="tag">
                {ts(c.start_seconds)}–{ts(c.end_seconds)} ({Math.round(c.length_seconds)}s)
              </span>
              {c.source_url && (
                <a
                  className="tag link"
                  href={`${c.source_url}&t=${Math.floor(c.start_seconds)}s`}
                  target="_blank"
                  rel="noreferrer"
                >
                  ▶ watch source
                </a>
              )}
            </div>
            <div className="moment-status">
              <span className={`pill ${c.render_status === "rendered" ? "done" : "queued"}`}>
                {c.render_status === "rendered" ? "rendered" : "render pending (OpenShorts)"}
              </span>
              <span className={`pill ${c.post_status === "posted" ? "done" : "queued"}`}>
                {c.post_status === "posted"
                  ? `posted · ${c.views.toLocaleString()} views`
                  : "not posted (needs platform creds)"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
