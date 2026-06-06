"use client";
// Editing Studio (MOCK) — drop in a clip, watch it "get edited" through caption / cut /
// effect stages, then the SAME clip appears in the FINAL box. No real editing happens yet:
// the whole timeline comes from lib/anim-controller.ts, which is where real OpenShorts cues
// will plug in later. This file is purely the GUI + the animation driver.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Film,
  Captions,
  Scissors,
  Sparkles,
  Clapperboard,
  Wand2,
  Upload,
  FileVideo,
  X,
  Play,
  RotateCcw,
  Check,
  Crop,
  Music,
  Type,
  Zap,
  Download,
  CheckCircle2,
  type LucideIcon,
} from "lucide-react";
import { SectionCard, Button } from "@/components/ui";
import {
  getEditTimeline,
  timelineStateAt,
  totalDurationMs,
  type EditStage,
  type StageAccent,
  type EditOpKind,
} from "@/lib/anim-controller";

const STAGE_ICONS: Record<string, LucideIcon> = {
  film: Film,
  captions: Captions,
  scissors: Scissors,
  sparkles: Sparkles,
  clapperboard: Clapperboard,
};

const OP_ICONS: Record<EditOpKind, LucideIcon> = {
  ingest: Film,
  caption: Type,
  cut: Scissors,
  reframe: Crop,
  effect: Sparkles,
  audio: Music,
  hook: Zap,
  render: Download,
};

// Full literal class strings per accent so Tailwind's JIT keeps them.
const ACCENT: Record<
  StageAccent,
  { text: string; border: string; glow: string; ring: string; dot: string }
> = {
  neutral: {
    text: "text-neutral-300",
    border: "border-neutral-700",
    glow: "shadow-[0_0_24px_-6px_rgba(255,255,255,0.25)]",
    ring: "ring-neutral-600/50",
    dot: "bg-neutral-400",
  },
  violet: {
    text: "text-violet-300",
    border: "border-violet-700/70",
    glow: "shadow-[0_0_28px_-6px_rgba(167,139,250,0.55)]",
    ring: "ring-violet-500/50",
    dot: "bg-violet-400",
  },
  sky: {
    text: "text-sky-300",
    border: "border-sky-700/70",
    glow: "shadow-[0_0_28px_-6px_rgba(56,189,248,0.55)]",
    ring: "ring-sky-500/50",
    dot: "bg-sky-400",
  },
  amber: {
    text: "text-amber-300",
    border: "border-amber-700/70",
    glow: "shadow-[0_0_28px_-6px_rgba(251,191,36,0.55)]",
    ring: "ring-amber-500/50",
    dot: "bg-amber-400",
  },
  emerald: {
    text: "text-emerald-300",
    border: "border-emerald-700/70",
    glow: "shadow-[0_0_28px_-6px_rgba(52,211,153,0.55)]",
    ring: "ring-emerald-500/50",
    dot: "bg-emerald-400",
  },
};

type Phase = "idle" | "running" | "done";

export default function MockEditingStudio() {
  const stages = useMemo<EditStage[]>(() => getEditTimeline(), []);
  const total = useMemo(() => totalDurationMs(stages), [stages]);

  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string>("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  // Object URL lifecycle — same blob is shown in both the RAW and FINAL previews.
  useEffect(() => {
    if (!file) {
      setUrl("");
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  const stopRaf = () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  };
  useEffect(() => stopRaf, []);

  const pick = (f: File | null) => {
    stopRaf();
    setFile(f);
    setPhase("idle");
    setElapsed(0);
  };

  const start = useCallback(() => {
    if (!file) return;
    stopRaf();
    setPhase("running");
    setElapsed(0);
    startRef.current = performance.now();
    const tick = (now: number) => {
      const e = now - startRef.current;
      if (e >= total) {
        setElapsed(total);
        setPhase("done");
        rafRef.current = null;
        return;
      }
      setElapsed(e);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [file, total]);

  const state = useMemo(
    () => timelineStateAt(elapsed, stages),
    [elapsed, stages],
  );
  const pct = Math.round(state.progress * 100);

  const sizeMB = file ? (file.size / (1024 * 1024)).toFixed(1) : "";

  return (
    <SectionCard
      title="Editing Studio"
      icon={Wand2}
      right={
        <span className="hidden items-center gap-1.5 font-mono text-[10px] text-neutral-600 sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500/80" />
          mock · OpenShorts-driven soon
        </span>
      }
    >
      {!file ? (
        // ---- Empty state: dropzone ----
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) pick(f);
          }}
          className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-neutral-800 bg-neutral-950/40 px-4 py-12 text-center transition-colors hover:border-neutral-700 hover:bg-neutral-950/70"
        >
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/*"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0] || null)}
          />
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-neutral-800 bg-neutral-900/60">
            <Upload size={20} className="text-neutral-500" />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-sm text-neutral-300">
              Drop a clip to start editing
            </span>
            <span className="font-mono text-[11px] text-neutral-600">
              .mp4 — we&apos;ll run it through the pipeline
            </span>
          </div>
        </label>
      ) : (
        <div className="flex flex-col gap-5">
          {/* ---- Pipeline row: RAW → stages → FINAL ---- */}
          <div className="flex flex-col items-stretch gap-3 lg:flex-row lg:items-center">
            <RawCard
              url={url}
              name={file.name}
              sizeMB={sizeMB}
              onClear={() => {
                pick(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            />

            <Connector active={phase !== "idle"} />

            {/* Middle: animated stage nodes */}
            <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {stages.map((stage, i) => {
                const status =
                  phase === "done" || i < state.activeIndex
                    ? "done"
                    : phase === "running" && i === state.activeIndex
                      ? "active"
                      : "pending";
                return (
                  <StageNode
                    key={stage.id}
                    stage={stage}
                    status={status}
                    opsDone={i === state.activeIndex ? state.opsDone : stage.ops.length}
                  />
                );
              })}
            </div>

            <Connector active={phase === "done"} />

            <FinalCard url={url} done={phase === "done"} name={file.name} />
          </div>

          {/* ---- Active-stage detail: operation chips ticking off ---- */}
          <ActiveDetail phase={phase} stage={stages[state.activeIndex]} opsDone={state.opsDone} />

          {/* ---- Progress + controls ---- */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-900">
                <motion.div
                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-500 via-sky-400 to-emerald-400"
                  animate={{ width: `${pct}%` }}
                  transition={{ ease: "linear", duration: 0.1 }}
                />
              </div>
              <span className="w-10 text-right font-mono text-[11px] tabular-nums text-neutral-500">
                {pct}%
              </span>
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-neutral-600">
                {phase === "idle" && "Ready to edit"}
                {phase === "running" &&
                  `Editing — ${stages[state.activeIndex]?.title ?? ""}…`}
                {phase === "done" && (
                  <span className="inline-flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 size={13} />
                    Edit complete — final clip ready
                  </span>
                )}
              </span>

              {phase === "done" ? (
                <Button variant="ghost" onClick={start}>
                  <RotateCcw size={14} />
                  Replay edit
                </Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={phase === "running"}
                  onClick={start}
                >
                  <Play size={14} />
                  {phase === "running" ? "Editing…" : "Start editing"}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ---- Sub-components ---------------------------------------------------------------------

function RawCard({
  url,
  name,
  sizeMB,
  onClear,
}: {
  url: string;
  name: string;
  sizeMB: string;
  onClear: () => void;
}) {
  return (
    <div className="relative w-full shrink-0 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 lg:w-44">
      <div className="flex items-center justify-between border-b border-neutral-900 px-3 py-1.5">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-neutral-500">
          <FileVideo size={11} className="text-neutral-500" />
          Raw clip
        </span>
        <button onClick={onClear} title="Remove">
          <X size={12} className="text-neutral-600 hover:text-rose-400" />
        </button>
      </div>
      <div className="relative aspect-video bg-black">
        {url ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video src={url} muted className="h-full w-full object-cover opacity-90" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <Film size={20} className="text-neutral-700" />
          </div>
        )}
      </div>
      <div className="truncate px-3 py-1.5 font-mono text-[10px] text-neutral-600">
        {name} {sizeMB && `· ${sizeMB} MB`}
      </div>
    </div>
  );
}

function FinalCard({ url, done, name }: { url: string; done: boolean; name: string }) {
  return (
    <div
      className={`relative w-full shrink-0 overflow-hidden rounded-xl border bg-neutral-950 transition-all duration-500 lg:w-44 ${
        done
          ? "border-emerald-700/60 shadow-[0_0_30px_-8px_rgba(52,211,153,0.55)]"
          : "border-neutral-800"
      }`}
    >
      <div className="flex items-center justify-between border-b border-neutral-900 px-3 py-1.5">
        <span
          className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${
            done ? "text-emerald-400" : "text-neutral-500"
          }`}
        >
          <Clapperboard size={11} />
          Final product
        </span>
        {done && (
          <span className="rounded bg-emerald-950/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-emerald-300">
            ready
          </span>
        )}
      </div>
      <div className="relative aspect-video bg-black">
        <AnimatePresence mode="wait">
          {done && url ? (
            <motion.video
              key="final"
              src={url}
              controls
              className="h-full w-full object-cover"
              initial={{ opacity: 0, scale: 1.04 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            />
          ) : (
            <motion.div
              key="waiting"
              className="flex h-full flex-col items-center justify-center gap-1.5"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <Clapperboard size={20} className="text-neutral-700" />
              <span className="font-mono text-[9px] uppercase tracking-wider text-neutral-700">
                waiting for edit
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="truncate px-3 py-1.5 font-mono text-[10px] text-neutral-600">
        {done ? `${name} · edited` : "—"}
      </div>
    </div>
  );
}

function StageNode({
  stage,
  status,
  opsDone,
}: {
  stage: EditStage;
  status: "pending" | "active" | "done";
  opsDone: number;
}) {
  const a = ACCENT[stage.accent];
  const Icon = STAGE_ICONS[stage.icon] ?? Film;
  return (
    <motion.div
      animate={{
        scale: status === "active" ? 1.03 : 1,
        opacity: status === "pending" ? 0.55 : 1,
      }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className={`relative flex flex-col gap-1.5 overflow-hidden rounded-lg border bg-neutral-950/80 p-2.5 ${
        status === "active"
          ? `${a.border} ${a.glow} ring-1 ${a.ring}`
          : status === "done"
            ? "border-emerald-900/50"
            : "border-neutral-900"
      }`}
    >
      {status === "active" && (
        <span className="stage-beam pointer-events-none absolute inset-0" />
      )}
      <div className="flex items-center justify-between">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-md border ${
            status === "done"
              ? "border-emerald-900/60 text-emerald-300"
              : status === "active"
                ? `${a.border} ${a.text}`
                : "border-neutral-900 text-neutral-600"
          }`}
        >
          {status === "done" ? (
            <Check size={13} />
          ) : (
            <Icon size={13} className={status === "active" ? "animate-pulse" : ""} />
          )}
        </span>
        {status === "active" && (
          <span className={`h-1.5 w-1.5 rounded-full ${a.dot} animate-pulse`} />
        )}
      </div>
      <span
        className={`truncate text-[11px] font-medium ${
          status === "pending" ? "text-neutral-500" : "text-neutral-200"
        }`}
      >
        {stage.title}
      </span>
      {/* per-stage op progress dots */}
      <div className="flex gap-1">
        {stage.ops.map((_, i) => (
          <span
            key={i}
            className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${
              status === "done" || i < opsDone
                ? "bg-emerald-500/70"
                : status === "active" && i === opsDone
                  ? a.dot
                  : "bg-neutral-800"
            }`}
          />
        ))}
      </div>
    </motion.div>
  );
}

function ActiveDetail({
  phase,
  stage,
  opsDone,
}: {
  phase: Phase;
  stage?: EditStage;
  opsDone: number;
}) {
  if (phase === "idle" || !stage) {
    return (
      <div className="rounded-lg border border-neutral-900 bg-neutral-950/40 px-4 py-3 text-center font-mono text-[11px] text-neutral-600">
        Press <span className="text-neutral-400">Start editing</span> to run the clip through
        captions, cuts & effects.
      </div>
    );
  }
  const a = ACCENT[stage.accent];
  return (
    <div className="rounded-lg border border-neutral-900 bg-neutral-950/40 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className={`text-[11px] font-medium uppercase tracking-wider ${a.text}`}>
          {stage.title}
        </span>
        <span className="font-mono text-[10px] text-neutral-600">{stage.blurb}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <AnimatePresence>
          {stage.ops.map((op, i) => {
            const opDone = phase === "done" || i < opsDone;
            const opActive = phase === "running" && i === opsDone;
            if (!opDone && !opActive) return null;
            const OpIcon = OP_ICONS[op.kind] ?? Sparkles;
            return (
              <motion.span
                key={op.id}
                layout
                initial={{ opacity: 0, y: 6, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", stiffness: 400, damping: 24 }}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] ${
                  opDone
                    ? "border-emerald-900/50 bg-emerald-950/20 text-emerald-300"
                    : `${a.border} bg-neutral-950 ${a.text}`
                }`}
              >
                {opDone ? (
                  <Check size={11} />
                ) : (
                  <OpIcon size={11} className="animate-pulse" />
                )}
                {op.label}
              </motion.span>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Connector({ active }: { active: boolean }) {
  return (
    <div className="relative mx-auto hidden h-6 w-8 shrink-0 items-center justify-center lg:flex">
      <div className="h-px w-full bg-neutral-800" />
      <motion.div
        className="absolute h-px w-full bg-gradient-to-r from-transparent via-sky-400 to-transparent"
        animate={active ? { opacity: [0, 1, 0], x: ["-50%", "50%"] } : { opacity: 0 }}
        transition={{ duration: 1.2, repeat: active ? Infinity : 0, ease: "easeInOut" }}
      />
    </div>
  );
}
