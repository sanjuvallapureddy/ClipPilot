"use client";
import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  Play,
  Clock,
  CheckCircle2,
  CircleDashed,
  Loader2,
  ExternalLink,
  Quote,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ClipResult } from "@/lib/types";
import { Badge, YouTubeGlyph } from "@/components/ui";

function ts(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function ClipDrawer({
  clip,
  onClose,
  onUpload,
  uploading,
  error,
}: {
  clip: ClipResult | null;
  onClose: () => void;
  onUpload: (clipId: string) => void;
  uploading: boolean;
  error?: string;
}) {
  const posted = clip?.post_status === "posted";
  const rendered = clip?.render_status === "rendered";
  const [videoFailed, setVideoFailed] = useState(false);
  useEffect(() => setVideoFailed(false), [clip?.clip_id]);

  return (
    <AnimatePresence>
      {clip && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm"
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 38 }}
            className="fixed right-0 top-0 z-[81] flex h-full w-full max-w-md flex-col border-l border-neutral-800 bg-neutral-950 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-neutral-900 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-base font-semibold tabular-nums text-emerald-400">
                  {clip.engagement_score.toFixed(2)}
                </span>
                <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
                  predicted virality
                </span>
              </div>
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-800 text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-100"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {rendered && clip.clip_url && !videoFailed ? (
                <div className="overflow-hidden rounded-lg border border-neutral-800 bg-black">
                  <video
                    key={clip.clip_url}
                    src={clip.clip_url}
                    controls
                    playsInline
                    preload="metadata"
                    onError={() => setVideoFailed(true)}
                    className="mx-auto max-h-[55vh] w-auto"
                  />
                </div>
              ) : (
                <div className="flex aspect-[9/16] max-h-[40vh] items-center justify-center rounded-lg border border-dashed border-neutral-800 bg-black/40 px-4 text-center font-mono text-[11px] leading-relaxed text-neutral-600">
                  {rendered && videoFailed
                    ? "this clip's file is no longer on the OpenShorts server (cleaned up) — re-run to regenerate"
                    : "render pending — OpenShorts hasn't produced this clip yet"}
                </div>
              )}

              <div>
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-neutral-500">
                  <YouTubeGlyph size={11} className="text-red-500" />
                  Title — burned on video & used on YouTube
                </div>
                <h3 className="text-lg font-semibold leading-snug tracking-tight text-neutral-100">
                  {clip.title || clip.hook}
                </h3>
                {clip.hook && clip.hook !== clip.title && (
                  <p className="mt-1.5 text-[13px] leading-snug text-neutral-400">
                    {clip.hook}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {clip.topic && <Badge>{clip.topic}</Badge>}
                <Badge>
                  <Clock size={10} className="text-neutral-500" />
                  {ts(clip.start_seconds)}–{ts(clip.end_seconds)} (
                  {Math.round(clip.length_seconds)}s)
                </Badge>
                <Badge className={rendered ? "border-emerald-900/60 text-emerald-300" : ""}>
                  {rendered ? <CheckCircle2 size={10} /> : <CircleDashed size={10} />}
                  {rendered ? "rendered" : "render pending"}
                </Badge>
                <Badge className={posted ? "border-emerald-900/60 text-emerald-300" : ""}>
                  {posted ? <CheckCircle2 size={10} /> : <CircleDashed size={10} />}
                  {posted ? `${clip.views.toLocaleString()} views` : "not posted"}
                </Badge>
              </div>

              {clip.quote && (
                <div>
                  <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-neutral-500">
                    <Quote size={11} /> Transcript moment
                  </div>
                  <p className="border-l-2 border-neutral-700 pl-3 text-sm italic leading-relaxed text-neutral-300">
                    “{clip.quote}”
                  </p>
                </div>
              )}

              {clip.reason && (
                <div>
                  <div className="mb-1.5 text-[10px] font-medium uppercase tracking-widest text-neutral-500">
                    Why it's viral
                  </div>
                  <p className="text-sm leading-relaxed text-neutral-400">{clip.reason}</p>
                </div>
              )}

              {posted && clip.platform === "youtube" && clip.post_id && (
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: "views", value: clip.views },
                    { label: "likes", value: clip.likes },
                    { label: "shares", value: clip.shares },
                  ].map((m) => (
                    <div
                      key={m.label}
                      className="rounded-lg border border-neutral-900 bg-black p-3"
                    >
                      <div className="font-mono text-lg font-semibold text-neutral-100">
                        {(m.value ?? 0).toLocaleString()}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-neutral-600">
                        {m.label}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 border-t border-neutral-900 px-5 py-4">
              {clip.source_url && (
                <a
                  href={`${clip.source_url}&t=${Math.floor(clip.start_seconds)}s`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs text-neutral-300 transition-colors hover:border-neutral-700 hover:text-white"
                >
                  <Play size={13} />
                  Watch source
                </a>
              )}
              {posted && clip.platform === "youtube" && clip.post_id ? (
                <a
                  href={`https://www.youtube.com/watch?v=${clip.post_id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-900/60 bg-emerald-950/20 px-3 py-1.5 text-xs text-emerald-300 transition-colors hover:border-emerald-800"
                >
                  <YouTubeGlyph size={13} className="text-red-500" />
                  View on YouTube
                  <ExternalLink size={11} />
                </a>
              ) : (
                <button
                  onClick={() => onUpload(clip.clip_id)}
                  disabled={uploading}
                  className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-1.5 text-xs font-medium text-black transition-all hover:bg-neutral-200 disabled:opacity-50"
                >
                  {uploading ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <YouTubeGlyph size={13} className="text-red-500" />
                  )}
                  {uploading ? "Uploading…" : "Upload to YouTube"}
                </button>
              )}
              {error && (
                <span className="font-mono text-[10px] leading-tight text-rose-400/80">
                  {error}
                </span>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
