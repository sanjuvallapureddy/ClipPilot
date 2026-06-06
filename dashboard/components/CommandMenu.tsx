"use client";
import { useEffect, useState } from "react";
import { Command } from "cmdk";
import {
  Play,
  Search,
  Power,
  Square,
  Activity,
  Flame,
  ListVideo,
  BarChart3,
  CornerDownLeft,
} from "lucide-react";

export const OPEN_COMMAND_EVENT = "clippilot:open-command";

export function openCommandMenu() {
  window.dispatchEvent(new Event(OPEN_COMMAND_EVENT));
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function CommandMenu({
  running,
  onRunOnce,
  onDiscover,
  onToggleAuto,
}: {
  running: boolean;
  onRunOnce: () => void;
  onDiscover: () => void;
  onToggleAuto: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_EVENT, onOpen);
    };
  }, []);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const itemCls =
    "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-neutral-300 aria-selected:bg-neutral-900 aria-selected:text-neutral-100 cursor-pointer transition-colors";

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command Menu"
      className="fixed left-1/2 top-[20%] z-[70] w-[92vw] max-w-lg -translate-x-1/2 overflow-hidden rounded-xl border border-neutral-800 bg-black/80 shadow-2xl backdrop-blur-md"
      overlayClassName="fixed inset-0 z-[65] bg-black/60 backdrop-blur-[2px]"
    >
      <div className="flex items-center gap-2 border-b border-neutral-900 px-4">
        <Search size={15} className="text-neutral-500" />
        <Command.Input
          placeholder="Type a command or search…"
          className="h-12 flex-1 bg-transparent text-sm text-neutral-100 placeholder:text-neutral-600 focus:outline-none"
        />
        <kbd className="rounded border border-neutral-800 bg-neutral-900 px-1.5 py-0.5 font-mono text-[10px] text-neutral-500">
          ESC
        </kbd>
      </div>
      <Command.List className="max-h-[320px] overflow-y-auto p-2">
        <Command.Empty className="px-2.5 py-6 text-center text-sm text-neutral-600">
          No results.
        </Command.Empty>

        <Command.Group
          heading="Pipeline"
          className="px-1 py-1 text-[10px] font-medium uppercase tracking-widest text-neutral-600 [&_[cmdk-group-items]]:mt-1 [&_[cmdk-group-items]]:space-y-0.5"
        >
          <Command.Item className={itemCls} onSelect={() => run(onRunOnce)}>
            <Play size={15} className="text-neutral-500" />
            Run one cycle
            <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-neutral-600">
              <CornerDownLeft size={11} />
            </span>
          </Command.Item>
          <Command.Item className={itemCls} onSelect={() => run(onDiscover)}>
            <Search size={15} className="text-neutral-500" />
            Discover trending podcasts
          </Command.Item>
          <Command.Item className={itemCls} onSelect={() => run(onToggleAuto)}>
            {running ? (
              <Square size={15} className="text-rose-400/80" />
            ) : (
              <Power size={15} className="text-neutral-500" />
            )}
            {running ? "Stop autonomous loop" : "Start autonomous loop"}
          </Command.Item>
        </Command.Group>

        <Command.Group
          heading="Navigate"
          className="mt-2 px-1 py-1 text-[10px] font-medium uppercase tracking-widest text-neutral-600 [&_[cmdk-group-items]]:mt-1 [&_[cmdk-group-items]]:space-y-0.5"
        >
          <Command.Item className={itemCls} onSelect={() => run(() => scrollToSection("live-pipeline"))}>
            <Activity size={15} className="text-neutral-500" />
            Live Pipeline
          </Command.Item>
          <Command.Item className={itemCls} onSelect={() => run(() => scrollToSection("viral-moments"))}>
            <Flame size={15} className="text-neutral-500" />
            Detected Viral Moments
          </Command.Item>
          <Command.Item className={itemCls} onSelect={() => run(() => scrollToSection("discovered-queue"))}>
            <ListVideo size={15} className="text-neutral-500" />
            Discovered Queue
          </Command.Item>
          <Command.Item className={itemCls} onSelect={() => run(() => scrollToSection("analytics"))}>
            <BarChart3 size={15} className="text-neutral-500" />
            Analytics
          </Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
