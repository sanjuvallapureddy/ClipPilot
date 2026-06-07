"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ListVideo } from "lucide-react";
import type { DiscoveryItem } from "@/lib/types";
import { SectionCard, Badge, Skeleton } from "@/components/ui";
import { formatScore } from "@/lib/format";

export default function DiscoveredQueue({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<(DiscoveryItem & { id: string })[] | null>(null);

  useEffect(() => {
    let on = true;
    const load = () =>
      fetch("/api/queue")
        .then((r) => r.json())
        .then((d) => on && setItems(d.items || []))
        .catch(() => on && setItems([]));
    load();
    const t = setInterval(load, 4000);
    return () => {
      on = false;
      clearInterval(t);
    };
  }, [refreshKey]);

  return (
    <SectionCard
      title="Discovered Queue"
      icon={ListVideo}
      right={
        <span className="font-mono text-[11px] text-neutral-500">{items?.length ?? "—"}</span>
      }
    >
      {items === null && (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="h-4 w-8" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2.5 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      )}
      {items?.length === 0 && (
        <div className="py-6 text-center font-mono text-xs text-neutral-600">
          No candidates yet — ask the copilot to discover.
        </div>
      )}
      <div className="flex flex-col">
        {(items ?? []).map((it) => (
          <motion.div
            key={it.id}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-3 border-b border-neutral-900/70 py-2.5 last:border-b-0"
          >
            <span className="font-mono text-sm font-semibold tabular-nums text-emerald-400">
              {formatScore(it.trend_score)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-neutral-200">{it.title}</div>
              <div className="truncate font-mono text-[10px] text-neutral-500">
                {it.podcast} · {it.topic}
              </div>
            </div>
            <Badge>{it.source}</Badge>
          </motion.div>
        ))}
      </div>
    </SectionCard>
  );
}
