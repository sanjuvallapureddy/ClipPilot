"use client";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  CheckCircle2,
  CircleDashed,
  Clock3,
  ExternalLink,
  Film,
  Scissors,
  Sparkles,
} from "lucide-react";
import type { ClipResult } from "@/lib/types";
import { Badge, SectionCard, Skeleton, YouTubeGlyph } from "@/components/ui";

function formatClipTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function activityTime(clip: ClipResult) {
  const posted = Date.parse(clip.posted_at || "");
  if (Number.isFinite(posted) && posted > 0) return posted;
  if (clip.updated_at) return clip.updated_at * 1000;
  if (clip.created_at) return clip.created_at * 1000;
  return 0;
}

function relativeTime(ms: number) {
  if (!ms) return "just now";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

function statusLabel(clip: ClipResult) {
  if (clip.post_status === "posted") return "posted";
  if (clip.render_status === "rendered") return "edited";
  return "clipped";
}

function statusIcon(clip: ClipResult) {
  if (clip.post_status === "posted") return CheckCircle2;
  if (clip.render_status === "rendered") return Film;
  return Scissors;
}

export default function RecentClipHistory({ refreshKey }: { refreshKey: number }) {
  const [clips, setClips] = useState<ClipResult[] | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      fetch("/api/clips")
        .then((r) => r.json())
        .then((data) => {
          if (active) setClips(data.clips || []);
        })
        .catch(() => {
          if (active) setClips([]);
        });

    load();
    const timer = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refreshKey]);

  const recent = useMemo(
    () => [...(clips ?? [])].sort((a, b) => activityTime(b) - activityTime(a)).slice(0, 8),
    [clips],
  );

  const renderedCount = clips?.filter((clip) => clip.render_status === "rendered").length ?? 0;
  const postedCount = clips?.filter((clip) => clip.post_status === "posted").length ?? 0;

  return (
    <SectionCard
      title="Recent Clip History"
      icon={Clock3}
      right={
        <div className="flex items-center gap-1.5 font-mono text-[10px] text-neutral-500">
          <span>{clips?.length ?? "-"} total</span>
          <span className="text-neutral-700">/</span>
          <span>{renderedCount} edited</span>
          <span className="text-neutral-700">/</span>
          <span>{postedCount} posted</span>
        </div>
      }
    >
      {clips === null && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-3 rounded-lg border border-neutral-900 p-4">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}

      {clips?.length === 0 && (
        <div className="py-8 text-center">
          <Sparkles size={20} className="mx-auto mb-3 text-neutral-700" />
          <p className="font-mono text-xs text-neutral-500">
            No clip history yet. Run ClipPilot to create the first edited moment.
          </p>
        </div>
      )}

      <div className="relative">
        {recent.length > 0 && (
          <div className="absolute bottom-4 left-[17px] top-4 w-px bg-neutral-900" />
        )}
        <div className="space-y-3">
          {recent.map((clip, index) => {
            const StatusIcon = statusIcon(clip);
            const posted = clip.post_status === "posted" && clip.platform === "youtube" && clip.post_id;
            return (
              <motion.article
                key={clip.clip_id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: index * 0.035 }}
                className="relative flex gap-3 rounded-lg border border-neutral-900 bg-neutral-950/25 p-4 transition-colors hover:border-neutral-800 hover:bg-neutral-950/50"
              >
                <div className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-neutral-800 bg-black">
                  <StatusIcon
                    size={15}
                    className={
                      clip.post_status === "posted"
                        ? "text-emerald-400"
                        : clip.render_status === "rendered"
                          ? "text-blue-400"
                          : "text-amber-400"
                    }
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    <Badge className="uppercase">
                      {clip.post_status === "posted" ? (
                        <CheckCircle2 size={10} />
                      ) : (
                        <CircleDashed size={10} className="text-neutral-500" />
                      )}
                      {statusLabel(clip)}
                    </Badge>
                    {clip.topic && <Badge>{clip.topic}</Badge>}
                    <span className="font-mono text-[10px] text-neutral-600">
                      {relativeTime(activityTime(clip))}
                    </span>
                  </div>

                  <h3 className="truncate text-sm font-medium leading-snug text-neutral-100">
                    {clip.title || clip.hook || clip.clip_id}
                  </h3>
                  {clip.hook && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-neutral-400">
                      {clip.hook}
                    </p>
                  )}
                  {clip.quote && (
                    <p className="mt-2 line-clamp-2 border-l-2 border-neutral-800 pl-3 text-xs italic leading-relaxed text-neutral-500">
                      "{clip.quote}"
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <Badge>
                      <Clock3 size={10} className="text-neutral-500" />
                      {formatClipTime(clip.start_seconds)}-{formatClipTime(clip.end_seconds)}
                    </Badge>
                    <Badge>{Math.round(clip.length_seconds)}s short</Badge>
                    <Badge>{clip.engagement_score.toFixed(2)} virality</Badge>
                    {posted && (
                      <a
                        href={`https://www.youtube.com/watch?v=${clip.post_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-900/60 bg-emerald-950/20 px-2 py-0.5 font-mono text-[10px] text-emerald-300 transition-colors hover:border-emerald-800"
                      >
                        <YouTubeGlyph size={10} className="text-red-500" />
                        YouTube
                        <ExternalLink size={9} />
                      </a>
                    )}
                  </div>
                </div>
              </motion.article>
            );
          })}
        </div>
      </div>
    </SectionCard>
  );
}
