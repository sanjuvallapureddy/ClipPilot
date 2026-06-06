"use client";
import { useEffect, useState } from "react";
import { ListVideo } from "lucide-react";
import type { DiscoveryItem } from "@/lib/types";
import { SectionCard, Badge } from "@/components/ui";

export default function DiscoveredQueue({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<(DiscoveryItem & { id: string })[]>([]);

  useEffect(() => {
    let on = true;
    const load = () =>
      fetch("/api/queue")
        .then((r) => r.json())
        .then((d) => on && setItems(d.items || []))
        .catch(() => {});
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
      right={<span className="font-mono text-[11px] text-neutral-500">{items.length}</span>}
    >
      {items.length === 0 && (
        <div className="py-6 text-center font-mono text-xs text-neutral-600">
          No candidates yet — ask the copilot to discover.
        </div>
      )}
      <div className="flex flex-col">
        {items.map((it) => (
          <div
            key={it.id}
            className="flex items-center gap-3 border-b border-neutral-900/70 py-2.5 last:border-b-0"
          >
            <span className="font-mono text-sm font-semibold tabular-nums text-emerald-400">
              {(it.trend_score ?? 0).toFixed(2)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-neutral-200">{it.title}</div>
              <div className="truncate font-mono text-[10px] text-neutral-500">
                {it.podcast} · {it.topic}
              </div>
            </div>
            <Badge>{it.source}</Badge>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
