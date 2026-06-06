"use client";
import { useEffect, useState } from "react";
import { Flame, Play, Clock, CheckCircle2, CircleDashed } from "lucide-react";
import type { ClipResult } from "@/lib/types";
import { SectionCard, Badge } from "@/components/ui";

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
    <SectionCard
      title="Detected Viral Moments"
      icon={Flame}
      right={<span className="font-mono text-[11px] text-neutral-500">{clips.length}</span>}
    >
      {clips.length === 0 && (
        <div className="py-6 text-center font-mono text-xs leading-relaxed text-neutral-600">
          No moments yet. Run the pipeline on a real episode — moments are detected
          <br className="hidden sm:block" />
          from the real transcript by GPT.
        </div>
      )}
      <div className="flex flex-col gap-3">
        {clips.map((c) => {
          const rendered = c.render_status === "rendered";
          const posted = c.post_status === "posted";
          return (
            <div
              key={c.clip_id}
              className="group rounded-lg border border-neutral-900 bg-neutral-950/30 p-4 transition-all duration-300 hover:border-neutral-800 hover:bg-neutral-950/60"
            >
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-lg font-semibold tabular-nums text-emerald-400">
                  {c.engagement_score.toFixed(2)}
                </span>
                <span className="text-sm font-medium leading-snug text-neutral-100">
                  {c.hook}
                </span>
              </div>

              {c.quote && (
                <p className="my-2.5 border-l-2 border-neutral-700 pl-3 text-[13px] italic text-neutral-300">
                  “{c.quote}”
                </p>
              )}
              {c.reason && (
                <p className="mb-2.5 text-xs text-neutral-500">{c.reason}</p>
              )}

              <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                {c.topic && <Badge>{c.topic}</Badge>}
                <Badge>
                  <Clock size={10} className="text-neutral-500" />
                  {ts(c.start_seconds)}–{ts(c.end_seconds)} ({Math.round(c.length_seconds)}s)
                </Badge>
                {c.source_url && (
                  <a
                    href={`${c.source_url}&t=${Math.floor(c.start_seconds)}s`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-0.5 font-mono text-[10px] text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-100"
                  >
                    <Play size={10} />
                    watch source
                  </a>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Badge
                  className={
                    rendered ? "border-emerald-900/60 text-emerald-300" : ""
                  }
                >
                  {rendered ? (
                    <CheckCircle2 size={10} />
                  ) : (
                    <CircleDashed size={10} className="text-neutral-500" />
                  )}
                  {rendered ? "rendered" : "render pending (OpenShorts)"}
                </Badge>
                <Badge
                  className={posted ? "border-emerald-900/60 text-emerald-300" : ""}
                >
                  {posted ? (
                    <CheckCircle2 size={10} />
                  ) : (
                    <CircleDashed size={10} className="text-neutral-500" />
                  )}
                  {posted
                    ? `posted · ${c.views.toLocaleString()} views`
                    : "not posted (needs platform creds)"}
                </Badge>
              </div>
            </div>
          );
        })}
      </div>
    </SectionCard>
  );
}
