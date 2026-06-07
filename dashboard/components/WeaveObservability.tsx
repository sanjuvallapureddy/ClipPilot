"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity, ExternalLink, Radio, ShieldCheck, Workflow } from "lucide-react";

interface WeaveStatus {
  enabled: boolean;
  project: string;
  entity: string | null;
  model: string;
  dashboardUrl: string;
  tracedOps: { name: string; desc: string }[];
}

/**
 * Weave (Weights & Biases) is ClipPilot's AI observability layer. Every GPT
 * moment-detection call in the engine is wrapped with @weave.op, so each number on
 * this Analytics page is backed by a recorded trace (inputs, outputs, latency, token
 * cost, errors). This panel makes that role explicit and links straight to the traces.
 */
export default function WeaveObservability({ totalMoments }: { totalMoments: number }) {
  const [s, setS] = useState<WeaveStatus | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/weave/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => alive && setS(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const enabled = s?.enabled ?? false;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="relative overflow-hidden rounded-xl border border-violet-900/40 bg-gradient-to-br from-violet-950/30 via-neutral-950/40 to-cyan-950/20 p-5"
    >
      {/* ambient glow */}
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-violet-600/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-12 left-10 h-40 w-40 rounded-full bg-cyan-500/10 blur-3xl" />

      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-violet-800/50 bg-black/60">
            <Workflow size={18} className="text-violet-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold tracking-tight text-neutral-100">
                Weave · AI Observability
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                  enabled
                    ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-300"
                    : "border-amber-800/60 bg-amber-950/30 text-amber-300"
                }`}
              >
                <Radio size={9} className={enabled ? "animate-pulse" : ""} />
                {enabled ? "tracing active" : "key not set"}
              </span>
            </div>
            <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-neutral-400">
              Every GPT viral-moment call in the engine is wrapped with{" "}
              <code className="rounded bg-black/60 px-1 text-[11px] text-violet-300">@weave.op</code>{" "}
              — W&amp;B records each call&apos;s inputs, scores, latency, token cost, and errors, so
              the autonomous loop stays observable and tunable.
            </p>
          </div>
        </div>

        <a
          href={s?.dashboardUrl ?? "https://wandb.ai/home"}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg border border-violet-800/50 bg-violet-950/30 px-3 py-2 text-xs font-medium text-violet-200 transition-colors hover:border-violet-700 hover:bg-violet-900/40"
        >
          Open in W&amp;B Weave
          <ExternalLink size={13} />
        </a>
      </div>

      {/* stat strip */}
      <div className="relative mt-4 grid grid-cols-2 gap-3 border-t border-white/5 pt-4 sm:grid-cols-4">
        <Stat icon={Activity} label="Traced calls" value={totalMoments.toLocaleString()} hint="moment scores recorded" />
        <Stat icon={ShieldCheck} label="Model" value={s?.model ?? "—"} hint="under trace" />
        <Stat icon={Workflow} label="Project" value={s?.project ?? "—"} hint="W&B workspace" />
        <Stat
          icon={Radio}
          label="Ops traced"
          value={String(s?.tracedOps?.length ?? 0)}
          hint={s?.tracedOps?.map((o) => o.name).join(" · ") ?? ""}
        />
      </div>
    </motion.div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Activity;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-neutral-500">
        <Icon size={11} className="text-violet-400/80" />
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm font-semibold tabular-nums text-neutral-100">
        {value}
      </div>
      {hint && <div className="truncate text-[10px] text-neutral-600">{hint}</div>}
    </div>
  );
}
