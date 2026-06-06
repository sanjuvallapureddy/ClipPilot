"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { JobEvent } from "@/lib/types";

function clock(ts: number) {
  const d = ts > 1e12 ? new Date(ts) : new Date(ts * 1000);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

export default function ActivityTicker() {
  const [line, setLine] = useState<{ key: number; text: string } | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource("/api/jobs/stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("job", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as JobEvent;
      const subject = (ev.title || ev.job_id || "job").slice(0, 64);
      const text = `[${clock(ev.ts)}] ${ev.stage.toUpperCase()} · ${subject}${
        ev.message ? ` — ${ev.message}` : ""
      }`;
      setLine({ key: ev.ts + Math.random(), text });
    });
    return () => es.close();
  }, []);

  return (
    <div className="sticky bottom-0 z-30 flex h-8 items-center gap-3 overflow-hidden border-t border-neutral-900 bg-black/70 px-6 backdrop-blur-md">
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        {connected && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        )}
        <span
          className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
            connected ? "bg-emerald-400" : "bg-neutral-700"
          }`}
        />
      </span>
      <div className="relative h-4 flex-1 overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={line?.key ?? "idle"}
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -12, opacity: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 40 }}
            className="absolute inset-0 truncate font-mono text-[10px] leading-4 text-neutral-500"
          >
            {line?.text ?? "awaiting agent telemetry — jobs:stream idle"}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}
