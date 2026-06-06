"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Plus, LogOut } from "lucide-react";
import { Button, YouTubeGlyph } from "@/components/ui";

interface Account {
  channel_id: string;
  channel_title: string;
  thumbnail: string;
  email: string;
  active: boolean;
}

interface Status {
  configured: boolean;
  connected: boolean;
  accounts: Account[];
  active_channel_id: string | null;
}

export default function YouTubeConnect() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/youtube/status");
      setStatus(await r.json());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    // After returning from Google's consent screen the URL carries ?youtube=...
    const p = new URLSearchParams(window.location.search);
    if (p.get("youtube")) {
      load();
      window.history.replaceState({}, "", window.location.pathname);
    }
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const connect = () => {
    // Full-page redirect to Google's account chooser + consent.
    window.location.href = "/api/youtube/auth";
  };

  const activate = async (channel_id: string) => {
    await fetch("/api/youtube/account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "activate", channel_id }),
    });
    setOpen(false);
    load();
  };

  const disconnect = async (channel_id: string) => {
    await fetch("/api/youtube/account", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "disconnect", channel_id }),
    });
    load();
  };

  if (!status) return null;

  if (!status.configured) {
    return (
      <span className="hidden items-center gap-1.5 font-mono text-[10px] text-neutral-600 sm:inline-flex">
        <YouTubeGlyph size={13} className="text-neutral-700" />
        YouTube not configured
      </span>
    );
  }

  const active = status.accounts.find((a) => a.active);

  if (!status.connected) {
    return (
      <Button variant="ghost" onClick={connect}>
        <YouTubeGlyph size={14} className="text-red-500" />
        Connect YouTube
      </Button>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-md border border-neutral-900 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-300 transition-colors hover:border-neutral-800 hover:text-white"
      >
        <YouTubeGlyph size={14} className="text-red-500" />
        <span className="max-w-[120px] truncate">
          {active?.channel_title || "YouTube"}
        </span>
        <ChevronDown size={12} className="text-neutral-600" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-xl">
            <div className="border-b border-neutral-900 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-neutral-500">
              Upload target
            </div>
            <div className="max-h-64 overflow-y-auto">
              {status.accounts.map((a) => (
                <div
                  key={a.channel_id}
                  className="group flex items-center gap-2 px-3 py-2 hover:bg-neutral-900/60"
                >
                  <button
                    onClick={() => activate(a.channel_id)}
                    className="flex flex-1 items-center gap-2 text-left"
                  >
                    {a.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.thumbnail}
                        alt=""
                        className="h-6 w-6 rounded-full"
                      />
                    ) : (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-800">
                        <YouTubeGlyph size={12} className="text-red-500" />
                      </span>
                    )}
                    <span className="flex flex-col leading-tight">
                      <span className="max-w-[140px] truncate text-xs text-neutral-200">
                        {a.channel_title}
                      </span>
                      {a.email && (
                        <span className="max-w-[140px] truncate font-mono text-[10px] text-neutral-600">
                          {a.email}
                        </span>
                      )}
                    </span>
                  </button>
                  {a.active ? (
                    <Check size={14} className="text-emerald-400" />
                  ) : (
                    <button
                      onClick={() => disconnect(a.channel_id)}
                      title="Disconnect"
                      className="opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <LogOut size={13} className="text-neutral-600 hover:text-red-400" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              onClick={connect}
              className="flex w-full items-center gap-2 border-t border-neutral-900 px-3 py-2.5 text-xs text-neutral-300 hover:bg-neutral-900/60"
            >
              <Plus size={13} className="text-neutral-500" />
              Connect / switch account
            </button>
          </div>
        </>
      )}
    </div>
  );
}
