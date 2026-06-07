"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Hash, Lock, MessageSquareDashed } from "lucide-react";
import { AGENTS, CHANNELS, type ChatMessage } from "@/lib/types";

// Per-agent accent, aligned with the lane colors used elsewhere in the app
// (A=cyan, B=emerald, C=violet, D=amber).
const STYLE: Record<string, { text: string; bubble: string }> = {
  scout: { text: "text-cyan-300", bubble: "bg-cyan-500/10" },
  cutter: { text: "text-violet-300", bubble: "bg-violet-500/10" },
  coach: { text: "text-emerald-300", bubble: "bg-emerald-500/10" },
  pilot: { text: "text-amber-300", bubble: "bg-amber-500/10" },
};

function clock(ts: number) {
  const d = ts > 1e12 ? new Date(ts) : new Date(ts * 1000);
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function dmLabel(channel: string) {
  return channel
    .slice(3)
    .split("-")
    .map((p) => AGENTS[p]?.name ?? p)
    .join(" ↔ ");
}

/** Render message text with @mentions of real agents highlighted. */
function renderText(text: string) {
  return text.split(/(@[a-zA-Z0-9_]+)/g).map((part, i) => {
    const m = /^@([a-zA-Z0-9_]+)$/.exec(part);
    const agent = m && AGENTS[m[1].toLowerCase()];
    if (agent) {
      return (
        <span key={i} className="rounded bg-indigo-500/15 px-1 font-medium text-indigo-300">
          @{agent.name}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export default function TeamChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [active, setActive] = useState<string>("general");
  const [connected, setConnected] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const es = new EventSource("/api/chat/stream");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.addEventListener("chat", (e) => {
      const msg = JSON.parse((e as MessageEvent).data) as ChatMessage;
      setMessages((prev) => [...prev.slice(-400), msg]);
    });
    return () => es.close();
  }, []);

  // DM threads discovered from the stream (channels share one stream).
  const dms = useMemo(() => {
    const seen = new Set<string>();
    for (const m of messages) if (m.channel.startsWith("dm:")) seen.add(m.channel);
    return [...seen];
  }, [messages]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const m of messages) c[m.channel] = (c[m.channel] ?? 0) + 1;
    return c;
  }, [messages]);

  const visible = useMemo(
    () => messages.filter((m) => m.channel === active),
    [messages, active],
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [visible.length, active]);

  const isDM = active.startsWith("dm:");
  const title = isDM ? dmLabel(active) : active;

  return (
    <div className="flex min-h-0 flex-1">
      {/* Channel / DM rail */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-neutral-900 bg-black/40">
        <div className="flex h-11 items-center justify-between border-b border-neutral-900 px-3">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500">
            Workspace
          </span>
          <span className="flex items-center gap-1.5" title={connected ? "Live" : "Disconnected"}>
            <span className="relative flex h-1.5 w-1.5">
              {connected && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              )}
              <span
                className={`relative inline-flex h-1.5 w-1.5 rounded-full ${
                  connected ? "bg-emerald-400" : "bg-neutral-700"
                }`}
              />
            </span>
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          <div className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-widest text-neutral-600">
            Channels
          </div>
          {CHANNELS.map((ch) => (
            <ChannelButton
              key={ch}
              label={ch}
              icon={<Hash size={14} className="shrink-0" />}
              active={active === ch}
              count={counts[ch]}
              onClick={() => setActive(ch)}
            />
          ))}

          <div className="px-2 pb-1 pt-3 text-[10px] font-medium uppercase tracking-widest text-neutral-600">
            Direct Messages
          </div>
          {dms.length === 0 && (
            <div className="px-2 py-1 text-[11px] text-neutral-600">No DMs yet</div>
          )}
          {dms.map((ch) => {
            const ids = ch.slice(3).split("-");
            return (
              <ChannelButton
                key={ch}
                label={dmLabel(ch)}
                icon={<span className="shrink-0 text-xs">{AGENTS[ids[0]]?.emoji ?? "💬"}</span>}
                active={active === ch}
                count={counts[ch]}
                onClick={() => setActive(ch)}
              />
            );
          })}
        </div>

        <div className="border-t border-neutral-900 px-3 py-2 text-[10px] leading-relaxed text-neutral-600">
          4 peer agents · no orchestrator
        </div>
      </aside>

      {/* Messages */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 items-center gap-2 border-b border-neutral-900 px-5">
          {isDM ? (
            <Lock size={14} className="text-neutral-500" />
          ) : (
            <Hash size={15} className="text-neutral-500" />
          )}
          <span className="text-sm font-semibold tracking-tight text-neutral-100">{title}</span>
          <span className="text-[11px] text-neutral-600">
            {active === "activity"
              ? "· mirrored pipeline activity"
              : isDM
                ? "· direct message"
                : "· team channel"}
          </span>
        </div>

        <div ref={scrollRef} className="chat-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {visible.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-neutral-600">
              <MessageSquareDashed size={28} />
              <p className="text-sm">No messages in {isDM ? title : `#${active}`} yet.</p>
              <p className="text-[11px]">
                Run the pipeline — agents post here as real work happens.
              </p>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {visible.map((m, i) => {
                const prev = visible[i - 1];
                const grouped =
                  prev && prev.author === m.author && m.ts - prev.ts < 300 && prev.kind === m.kind;
                return <Message key={`${m.id ?? m.ts}-${i}`} m={m} grouped={!!grouped} />;
              })}
            </AnimatePresence>
          )}
        </div>

        {/* Read-only composer (you are observing the agents) */}
        <div className="border-t border-neutral-900 px-5 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-neutral-900 bg-neutral-950/60 px-3 py-2.5 text-[13px] text-neutral-600">
            <Lock size={13} className="shrink-0" />
            <span>Read-only — you are observing the agents talk to each other.</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChannelButton({
  label,
  icon,
  active,
  count,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
        active
          ? "bg-neutral-900/70 text-neutral-100"
          : "text-neutral-500 hover:bg-neutral-950 hover:text-neutral-300"
      }`}
    >
      <span className={active ? "text-neutral-300" : "text-neutral-600"}>{icon}</span>
      <span className="truncate">{label}</span>
      {count ? (
        <span className="ml-auto rounded-full bg-neutral-900 px-1.5 text-[10px] text-neutral-500">
          {count}
        </span>
      ) : null}
    </button>
  );
}

function Message({ m, grouped }: { m: ChatMessage; grouped: boolean }) {
  const meta = AGENTS[m.author];
  const style = STYLE[m.author] ?? { text: "text-neutral-300", bubble: "bg-neutral-800/40" };

  // Mirrored pipeline activity renders as a compact system line.
  if (m.kind === "event") {
    return (
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-2 py-0.5 pl-11 font-mono text-[11px] text-neutral-600"
      >
        <span className="text-neutral-700">{clock(m.ts)}</span>
        <span className="truncate">{m.text}</span>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 34 }}
      className={`flex gap-3 ${grouped ? "mt-0.5" : "mt-4"}`}
    >
      <div className="w-8 shrink-0">
        {!grouped && (
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950 text-base">
            {meta?.emoji ?? "🤖"}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className={`text-sm font-semibold ${style.text}`}>
              {meta?.name ?? m.author}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-neutral-600">
              {meta?.role ?? "agent"}
            </span>
            <span className="text-[10px] text-neutral-600">{clock(m.ts)}</span>
          </div>
        )}
        <div className="text-[13px] leading-relaxed text-neutral-300">{renderText(m.text)}</div>
      </div>
    </motion.div>
  );
}
