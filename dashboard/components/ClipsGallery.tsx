"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Flame,
  Play,
  Clock,
  CheckCircle2,
  CircleDashed,
  Loader2,
  ExternalLink,
} from "lucide-react";
import type { ClipResult } from "@/lib/types";
import { SectionCard, Badge, Skeleton, YouTubeGlyph } from "@/components/ui";

function ts(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function ClipsGallery({ refreshKey }: { refreshKey: number }) {
  const [clips, setClips] = useState<ClipResult[] | null>(null);
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const load = () =>
    fetch("/api/clips")
      .then((r) => r.json())
      .then((d) => setClips(d.clips || []))
      .catch(() => setClips([]));

  useEffect(() => {
    let on = true;
    const run = () => on && load();
    run();
    const t = setInterval(run, 5000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [refreshKey]);

  const upload = async (clipId: string) => {
    setUploading((u) => ({ ...u, [clipId]: true }));
    setErrors((e) => ({ ...e, [clipId]: "" }));
    try {
      const res = await fetch("/api/youtube/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clip_id: clipId, privacy: "private" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors((e) => ({ ...e, [clipId]: data.error || "upload failed" }));
      } else {
        await load();
      }
    } catch (e) {
      setErrors((er) => ({ ...er, [clipId]: String(e) }));
    } finally {
      setUploading((u) => ({ ...u, [clipId]: false }));
    }
  };

  return (
    <SectionCard
      title="Detected Viral Moments"
      icon={Flame}
      right={
        <span className="font-mono text-[11px] text-neutral-500">{clips?.length ?? "—"}</span>
      }
    >
      {clips === null && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="space-y-2.5 rounded-lg border border-neutral-900 p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-5 w-10" />
                <Skeleton className="h-4 w-2/3" />
              </div>
              <Skeleton className="h-3 w-full" />
              <div className="flex gap-1.5">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          ))}
        </div>
      )}
      {clips?.length === 0 && (
        <div className="py-6 text-center font-mono text-xs leading-relaxed text-neutral-600">
          No moments yet. Run the pipeline on a real episode — moments are detected
          <br className="hidden sm:block" />
          from the real transcript by GPT.
        </div>
      )}
      <div className="flex flex-col gap-3">
        {(clips ?? []).map((c) => {
          const rendered = c.render_status === "rendered";
          const posted = c.post_status === "posted";
          return (
            <motion.div
              key={c.clip_id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
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
                    : "not posted"}
                </Badge>
              </div>

              <div className="mt-3 flex items-center gap-2 border-t border-neutral-900 pt-3">
                {posted && c.platform === "youtube" && c.post_id ? (
                  <a
                    href={`https://www.youtube.com/watch?v=${c.post_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-900/60 bg-emerald-950/20 px-2.5 py-1 font-mono text-[11px] text-emerald-300 transition-colors hover:border-emerald-800"
                  >
                    <YouTubeGlyph size={12} className="text-red-500" />
                    View on YouTube
                    <ExternalLink size={10} />
                  </a>
                ) : (
                  <button
                    onClick={() => upload(c.clip_id)}
                    disabled={uploading[c.clip_id]}
                    className="inline-flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1 font-mono text-[11px] text-neutral-300 transition-colors hover:border-red-900/60 hover:text-white disabled:opacity-50"
                  >
                    {uploading[c.clip_id] ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <YouTubeGlyph size={12} className="text-red-500" />
                    )}
                    {uploading[c.clip_id] ? "Uploading…" : "Upload to YouTube"}
                  </button>
                )}
                {errors[c.clip_id] && (
                  <span className="font-mono text-[10px] leading-tight text-rose-400/80">
                    {errors[c.clip_id]}
                  </span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </SectionCard>
  );
}
