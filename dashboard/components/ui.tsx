"use client";
import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Download,
  AudioLines,
  Brain,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { useMotionValue, useSpring, animate } from "framer-motion";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { Stage } from "@/lib/types";

/**
 * Mouse-tracking glow: feeds --mx/--my CSS vars to a `.glow-surface` element so
 * the border illuminates exactly where the cursor sits (Linear/Vercel hallmark).
 */
export function useMouseGlow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const onMouseMove = (e: React.MouseEvent<T>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };
  return { ref, onMouseMove };
}

type ButtonVariant = "primary" | "ghost" | "danger";

const buttonBase =
  "inline-flex items-center justify-center gap-1.5 text-xs font-medium rounded-md px-3 py-1.5 transition-all disabled:opacity-40 disabled:pointer-events-none select-none";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-white text-black hover:bg-neutral-200 shadow-sm tracking-tight",
  ghost:
    "bg-transparent text-neutral-400 hover:text-white border border-neutral-900 hover:border-neutral-800 hover:bg-neutral-950",
  danger:
    "bg-transparent text-red-400/90 hover:text-red-300 border border-red-950 hover:border-red-900 hover:bg-red-950/30",
};

export const Button = forwardRef<
  HTMLButtonElement,
  {
    variant?: ButtonVariant;
    className?: string;
    children: ReactNode;
  } & React.ButtonHTMLAttributes<HTMLButtonElement>
>(function Button({ variant = "primary", className = "", children, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={`${buttonBase} ${buttonVariants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
});

export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`group flex flex-col rounded-lg border border-neutral-900 bg-black p-5 transition-all duration-300 hover:border-neutral-800 hover:bg-neutral-950/40 ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionCard({
  title,
  icon: Icon,
  right,
  className = "",
  children,
}: {
  title: string;
  icon?: LucideIcon;
  right?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const glow = useMouseGlow<HTMLDivElement>();
  return (
    <div
      ref={glow.ref}
      onMouseMove={glow.onMouseMove}
      className={`glow-surface rounded-lg border border-neutral-900 bg-black transition-colors duration-300 hover:border-neutral-800 ${className}`}
    >
      <div className="flex items-center justify-between border-b border-neutral-900 px-5 py-3">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={14} className="text-neutral-500" />}
          <h2 className="text-xs font-medium uppercase tracking-wider text-neutral-500">
            {title}
          </h2>
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export function MetricCard({
  title,
  value,
  description,
  icon: Icon,
}: {
  title: string;
  value: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="group rounded-lg border border-neutral-900 bg-black p-4 transition-all duration-200 hover:border-neutral-800 hover:bg-neutral-950/30">
      <div className="flex items-center justify-between pb-2">
        <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">
          {title}
        </p>
        {Icon && (
          <Icon
            size={16}
            className="text-neutral-600 opacity-60 transition-all duration-200 group-hover:-translate-y-px group-hover:text-neutral-300 group-hover:opacity-100"
          />
        )}
      </div>
      <div className="flex items-baseline gap-2">
        <div className="font-mono text-2xl font-semibold tracking-tight text-neutral-100">
          {value}
        </div>
        {description && (
          <span className="font-mono text-[10px] text-neutral-600">{description}</span>
        )}
      </div>
    </div>
  );
}

type GlowVariant = "red" | "blue" | "cyan" | "amber";

// Full literal class strings per variant so Tailwind's JIT scanner can see them.
const glowVariants: Record<
  GlowVariant,
  { border: string; text: string; glow: string; valueHover: string }
> = {
  red: {
    border: "border-rose-950/40 hover:border-rose-900/60",
    text: "text-rose-400",
    glow: "bg-rose-500/15",
    valueHover: "group-hover:text-rose-400",
  },
  blue: {
    border: "border-blue-950/40 hover:border-blue-900/50",
    text: "text-blue-400",
    glow: "bg-blue-500/10",
    valueHover: "group-hover:text-blue-400",
  },
  cyan: {
    border: "border-cyan-950/40 hover:border-cyan-900/50",
    text: "text-cyan-400",
    glow: "bg-cyan-500/10",
    valueHover: "group-hover:text-cyan-400",
  },
  amber: {
    border: "border-amber-950/40 hover:border-amber-900/50",
    text: "text-amber-400",
    glow: "bg-amber-500/10",
    valueHover: "group-hover:text-amber-400",
  },
};

const sparkStroke: Record<GlowVariant, string> = {
  red: "#fb7185",
  blue: "#60a5fa",
  cyan: "#22d3ee",
  amber: "#fbbf24",
};

export function GlowMetricCard({
  title,
  value,
  description,
  icon: Icon,
  variant,
  dot = false,
  pulse = false,
  sparkline,
}: {
  title: string;
  value: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  variant: GlowVariant;
  dot?: boolean;
  pulse?: boolean;
  sparkline?: number[];
}) {
  const s = glowVariants[variant];
  const glow = useMouseGlow<HTMLDivElement>();
  return (
    <div
      ref={glow.ref}
      onMouseMove={glow.onMouseMove}
      className={`glow-surface group relative overflow-hidden rounded-lg border bg-black p-5 transition-all duration-300 ${s.border}`}
    >
      {/* Localized ambient glow that intensifies on hover. */}
      <div
        className={`pointer-events-none absolute -right-10 -top-10 h-24 w-24 rounded-full ${s.glow} opacity-60 blur-2xl transition-opacity duration-300 group-hover:opacity-100`}
      />
      <div className="relative z-10 flex items-center justify-between">
        <p className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
          {title}
        </p>
        {dot ? (
          <span
            className={`h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_8px_currentColor] ${s.text} ${
              pulse ? "animate-[pulse_3s_ease-in-out_infinite]" : "opacity-60"
            }`}
          />
        ) : (
          Icon && (
            <Icon
              size={16}
              className={`${s.text} opacity-70 transition-all duration-300 group-hover:-translate-y-px group-hover:opacity-100`}
            />
          )
        )}
      </div>
      <div className="relative z-10 mt-3 flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span
            className={`font-mono text-2xl font-semibold tracking-tight text-neutral-100 transition-colors duration-300 ${s.valueHover}`}
          >
            {value}
          </span>
          {description && (
            <span className="font-mono text-[10px] text-neutral-600">{description}</span>
          )}
        </div>
        {sparkline && sparkline.length > 1 && (
          <Sparkline data={sparkline} stroke={sparkStroke[variant]} />
        )}
      </div>
    </div>
  );
}

export function Badge({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-0.5 font-mono text-[10px] text-neutral-400 ${className}`}
    >
      {children}
    </span>
  );
}

const stageMeta: Record<Stage, { icon: LucideIcon; cls: string; spin?: boolean }> = {
  queued: { icon: Clock, cls: "border-neutral-800 text-neutral-400" },
  fetching: { icon: Download, cls: "border-sky-900/60 text-sky-300", spin: false },
  transcribing: { icon: AudioLines, cls: "border-violet-900/60 text-violet-300" },
  analyzing: { icon: Brain, cls: "border-emerald-900/60 text-emerald-300" },
  done: { icon: CheckCircle2, cls: "border-emerald-900/60 text-emerald-300" },
  failed: { icon: XCircle, cls: "border-red-900/60 text-red-300" },
};

const ACTIVE_STAGES: Stage[] = ["fetching", "transcribing", "analyzing"];

export function StagePill({ stage }: { stage: Stage }) {
  const meta = stageMeta[stage] ?? stageMeta.queued;
  const Icon = ACTIVE_STAGES.includes(stage) ? Loader2 : meta.icon;
  const spin = ACTIVE_STAGES.includes(stage);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border bg-neutral-950 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${meta.cls}`}
    >
      <Icon size={11} className={spin ? "animate-spin" : ""} />
      {stage}
    </span>
  );
}

/** Ambient skeleton bar — slow neutral-950→900 pulse, GPU-composited. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton transform-gpu ${className}`} />;
}

/** Hyper-compact SVG sparkline with a soft gradient fill under the curve. */
export function Sparkline({
  data,
  stroke = "#22d3ee",
  width = 56,
  height = 20,
}: {
  data: number[];
  stroke?: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const pts = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / span) * (height - 2) - 1;
    return [x, y] as const;
  });
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const gid = `spark-${stroke.replace("#", "")}`;
  return (
    <svg width={width} height={height} className="overflow-visible opacity-70 transition-opacity duration-300 group-hover:opacity-100">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} stroke="none" />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.25} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Physics-driven counter: springs toward the target, overshoots, then snaps. */
export function AnimatedNumber({ value }: { value: number }) {
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { stiffness: 400, damping: 30 });
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const controls = animate(mv, value, { duration: 0 });
    return controls.stop;
  }, [mv, value]);

  useEffect(() => {
    const unsub = spring.on("change", (v) => setDisplay(Math.round(v)));
    return unsub;
  }, [spring]);

  return <>{display.toLocaleString()}</>;
}

/** Radix tooltip with an inline monospace hotkey hint, smoked-glass surface. */
export function Tooltip({
  label,
  hotkey,
  children,
}: {
  label: string;
  hotkey?: string;
  children: ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={8}
          className="z-50 flex items-center gap-2 rounded-md border border-neutral-800 bg-black/80 px-2.5 py-1.5 text-[11px] text-neutral-300 shadow-2xl backdrop-blur-md"
        >
          {label}
          {hotkey && (
            <kbd className="rounded border border-neutral-800 bg-neutral-900 px-1 py-0.5 font-mono text-[10px] text-neutral-400">
              {hotkey}
            </kbd>
          )}
          <TooltipPrimitive.Arrow className="fill-neutral-800" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;
