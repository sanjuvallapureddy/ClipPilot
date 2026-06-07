"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Clapperboard,
  LayoutDashboard,
  Activity,
  Flame,
  BarChart3,
  Compass,
  History,
  Info,
  PanelLeftClose,
  PanelLeft,
  X,
  Circle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Tooltip } from "@/components/ui";

export interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  accent: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, accent: "text-neutral-200" },
  { id: "live-pipeline", label: "Pipeline", icon: Activity, accent: "text-violet-400" },
  { id: "viral-moments", label: "Clips", icon: Flame, accent: "text-amber-400" },
  { id: "clip-history", label: "History", icon: History, accent: "text-emerald-400" },
  { id: "analytics", label: "Analytics", icon: BarChart3, accent: "text-blue-400" },
  { id: "discovered-queue", label: "Discovery", icon: Compass, accent: "text-cyan-400" },
];

export default function Sidebar({
  active,
  online,
  onNavigate,
}: {
  active: string;
  online: boolean | null;
  onNavigate: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const width = collapsed ? "w-16" : "w-56";

  return (
    <>
      <motion.aside
        animate={{ width: collapsed ? 64 : 224 }}
        transition={{ type: "spring", stiffness: 300, damping: 32 }}
        className={`sticky top-0 z-40 flex h-screen ${width} shrink-0 flex-col border-r border-neutral-900 bg-black/60 backdrop-blur-md`}
      >
        {/* Brand */}
        <div className="flex h-14 items-center gap-2.5 border-b border-neutral-900 px-4">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950">
            <Clapperboard size={16} className="text-neutral-100" />
          </div>
          {!collapsed && (
            <span className="truncate text-sm font-semibold tracking-tight text-neutral-100">
              ClipPilot
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {NAV_ITEMS.map((item) => {
            const isActive = active === item.id;
            const Icon = item.icon;
            const button = (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                className={`group relative flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors ${
                  isActive
                    ? "bg-neutral-900/70 text-neutral-100"
                    : "text-neutral-500 hover:bg-neutral-950 hover:text-neutral-300"
                } ${collapsed ? "justify-center" : ""}`}
              >
                {isActive && (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-neutral-100"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
                <Icon
                  size={16}
                  className={`shrink-0 transition-colors ${
                    isActive ? item.accent : "text-neutral-500 group-hover:text-neutral-300"
                  }`}
                />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </button>
            );
            return collapsed ? (
              <Tooltip key={item.id} label={item.label}>
                {button}
              </Tooltip>
            ) : (
              button
            );
          })}
        </nav>

        {/* Footer: health + about + collapse */}
        <div className="flex flex-col gap-1 border-t border-neutral-900 p-3">
          <div
            className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              {online && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                  online === null ? "bg-neutral-600" : online ? "bg-emerald-400" : "bg-rose-500"
                }`}
              />
            </span>
            {!collapsed && (
              <span
                className={`font-mono text-[10px] uppercase tracking-wide ${
                  online === null
                    ? "text-neutral-500"
                    : online
                      ? "text-emerald-400/90"
                      : "text-rose-400/90"
                }`}
              >
                {online === null ? "connecting" : online ? "systems online" : "orchestrator down"}
              </span>
            )}
          </div>

          {collapsed ? (
            <Tooltip label="About ClipPilot">
              <button
                onClick={() => setAboutOpen(true)}
                className="flex w-full items-center justify-center rounded-md px-2.5 py-2 text-neutral-500 transition-colors hover:bg-neutral-950 hover:text-neutral-300"
              >
                <Info size={16} />
              </button>
            </Tooltip>
          ) : (
            <button
              onClick={() => setAboutOpen(true)}
              className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm text-neutral-500 transition-colors hover:bg-neutral-950 hover:text-neutral-300"
            >
              <Info size={16} className="shrink-0" />
              <span>About</span>
            </button>
          )}

          <button
            onClick={() => setCollapsed((c) => !c)}
            className={`flex items-center gap-3 rounded-md px-2.5 py-2 text-sm text-neutral-500 transition-colors hover:bg-neutral-950 hover:text-neutral-300 ${
              collapsed ? "justify-center" : ""
            }`}
          >
            {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </motion.aside>

      <AboutModal open={aboutOpen} online={online} onClose={() => setAboutOpen(false)} />
    </>
  );
}

const LANES = [
  { dot: "bg-cyan-400", name: "Lane A · Discovery", desc: "trending search + autonomous loop" },
  { dot: "bg-emerald-400", name: "Lane B · Performance", desc: "real metrics → learned patterns" },
  { dot: "bg-violet-400", name: "Lane C · Engine", desc: "transcript → GPT moment detection" },
  { dot: "bg-amber-400", name: "Lane D · Dashboard", desc: "this mission-control surface" },
];

function AboutModal({
  open,
  online,
  onClose,
}: {
  open: boolean;
  online: boolean | null;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            className="fixed left-1/2 top-1/2 z-[91] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950 shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-neutral-900 px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-800 bg-black">
                  <Clapperboard size={14} className="text-neutral-100" />
                </div>
                <span className="text-sm font-semibold tracking-tight text-neutral-100">
                  ClipPilot
                </span>
              </div>
              <button
                onClick={onClose}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-neutral-800 text-neutral-400 transition-colors hover:border-neutral-700 hover:text-neutral-100"
              >
                <X size={14} />
              </button>
            </div>

            <div className="space-y-5 px-5 py-5">
              <p className="text-sm leading-relaxed text-neutral-400">
                An autonomous agent that finds trending podcasts, clips viral moments into
                vertical shorts, auto-posts them, measures performance, learns, and repeats —
                with no human in the loop after launch.
              </p>

              <div>
                <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-neutral-500">
                  Architecture
                </div>
                <div className="flex flex-col gap-2">
                  {LANES.map((l) => (
                    <div key={l.name} className="flex items-start gap-2.5">
                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${l.dot}`} />
                      <div>
                        <div className="text-xs text-neutral-200">{l.name}</div>
                        <div className="font-mono text-[10px] text-neutral-600">{l.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-neutral-900 bg-black px-3 py-2.5">
                <span className="text-[10px] font-medium uppercase tracking-widest text-neutral-500">
                  Orchestrator
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      online === null
                        ? "bg-neutral-600"
                        : online
                          ? "bg-emerald-400"
                          : "bg-rose-500"
                    }`}
                  />
                  <span
                    className={`font-mono text-[10px] uppercase ${
                      online === null
                        ? "text-neutral-500"
                        : online
                          ? "text-emerald-400/90"
                          : "text-rose-400/90"
                    }`}
                  >
                    {online === null ? "connecting" : online ? "online" : "offline"}
                  </span>
                </span>
              </div>

              <div>
                <div className="mb-2 text-[10px] font-medium uppercase tracking-widest text-neutral-500">
                  Powered by
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {["OpenAI", "Redis", "CopilotKit", "YouTube"].map((s) => (
                    <span
                      key={s}
                      className="inline-flex items-center gap-1 rounded-md border border-neutral-800 bg-black px-2 py-0.5 font-mono text-[10px] text-neutral-400"
                    >
                      <Circle size={6} className="fill-neutral-600 text-neutral-600" />
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
