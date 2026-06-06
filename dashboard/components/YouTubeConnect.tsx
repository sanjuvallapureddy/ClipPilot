"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, Plus, LogOut, X } from "lucide-react";
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
  reason?: string;
  error?: string;
}

// Friendly copy for the ?youtube=error&reason=... values the OAuth callback can return.
function errorMessage(reason: string): string {
  if (/access_denied/i.test(reason))
    return "Google blocked the connection. While the OAuth app is in Testing mode, only Google accounts added as test users can connect.";
  if (reason === "no_identity")
    return "Couldn't read your Google account. Try again and grant the requested permissions.";
  if (reason === "state_mismatch")
    return "Security check failed (state mismatch). Please try connecting again.";
  if (reason === "missing_code")
    return "Google didn't return an authorization code. Please try again.";
  if (reason === "redis_unavailable")
    return "Connected to Google, but ClipPilot couldn't save the account because Redis is unavailable. Start Redis and reconnect.";
  return `Couldn't connect: ${reason}`;
}

export default function YouTubeConnect() {
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    const yt = p.get("youtube");
    if (yt) {
      if (yt === "error") setError(errorMessage(p.get("reason") || "unknown"));
      load();
      window.history.replaceState({}, "", window.location.pathname);
    }
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!status) return;
    if (status.reason === "redis_unavailable") {
      setError(
        "YouTube is configured, but Redis is unavailable. Start Redis and reconnect your account.",
      );
    }
  }, [status]);

  const connect = () => {
    setError(null);
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

  // Not configured (missing API keys) — show a minimal ghost button so users know.
  if (!status.configured) {
    return (
      <button
        onClick={connect}
        title="Connect YouTube account"
        className="inline-flex items-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-xs text-neutral-400 transition-colors hover:border-neutral-700 hover:text-white"
      >
        <YouTubeGlyph size={13} className="text-red-500" />
        Connect YouTube
      </button>
    );
  }

  const active = status.accounts.find((a) => a.active);

  const errorBanner = error ? (
    <div className="absolute right-0 top-full z-40 mt-2 w-72 rounded-md border border-red-900/60 bg-red-950/70 px-3 py-2 text-[11px] leading-snug text-red-200">
      <div className="flex items-start gap-2">
        <span className="flex-1">{error}</span>
        <button
          onClick={() => setError(null)}
          className="text-red-400 hover:text-red-200"
          aria-label="Dismiss"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  ) : null;

  if (!status.connected) {
    return (
      <div className="relative">
        <Button variant="ghost" onClick={connect}>
          <YouTubeGlyph size={14} className="text-red-500" />
          Connect YouTube
        </Button>
        {errorBanner}
      </div>
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

      {errorBanner}

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
                  {a.active && (
                    <Check size={14} className="shrink-0 text-emerald-400" />
                  )}
                  <button
                    onClick={() => disconnect(a.channel_id)}
                    title="Disconnect this account"
                    className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                  >
                    <LogOut size={13} className="text-neutral-600 hover:text-red-400" />
                  </button>
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
