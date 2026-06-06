"use client";
import { useEffect, useRef, useState } from "react";
import { Upload, Loader2, ExternalLink, FileVideo, X } from "lucide-react";
import { SectionCard, Button, YouTubeGlyph } from "@/components/ui";

type Privacy = "private" | "unlisted" | "public";

export default function ManualUpload() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [channel, setChannel] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [privacy, setPrivacy] = useState<Privacy>("private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ watch_url: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/youtube/status")
        .then((r) => r.json())
        .then((d) => {
          setConnected(Boolean(d.connected));
          const active = (d.accounts || []).find((a: any) => a.active);
          setChannel(active?.channel_title || "");
        })
        .catch(() => setConnected(false));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const pick = (f: File | null) => {
    setFile(f);
    setResult(null);
    setError("");
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };

  const submit = async () => {
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", title || file.name);
      fd.append("privacy", privacy);
      const res = await fetch("/api/youtube/upload-file", {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) setError(data.error || "upload failed");
      else {
        setResult({ watch_url: data.watch_url });
        setFile(null);
        setTitle("");
        if (inputRef.current) inputRef.current.value = "";
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard title="Upload your own video" icon={Upload}>
      {connected === false && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-950/50 bg-amber-950/10 px-3 py-2 font-mono text-[11px] text-amber-400/90">
          <YouTubeGlyph size={12} className="text-red-500" />
          Connect a YouTube account first (top-right) to enable uploads.
        </div>
      )}

      {/* File picker */}
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) pick(f);
        }}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-neutral-800 bg-neutral-950/40 px-4 py-6 text-center transition-colors hover:border-neutral-700 hover:bg-neutral-950/70"
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] || null)}
        />
        {file ? (
          <span className="flex items-center gap-2 text-sm text-neutral-200">
            <FileVideo size={15} className="text-emerald-400" />
            {file.name}
            <span className="font-mono text-[10px] text-neutral-600">
              {(file.size / (1024 * 1024)).toFixed(1)} MB
            </span>
            <button
              onClick={(e) => {
                e.preventDefault();
                pick(null);
                if (inputRef.current) inputRef.current.value = "";
              }}
            >
              <X size={13} className="text-neutral-600 hover:text-rose-400" />
            </button>
          </span>
        ) : (
          <>
            <Upload size={18} className="text-neutral-500" />
            <span className="text-xs text-neutral-400">
              Drop an .mp4 here or click to choose a file
            </span>
          </>
        )}
      </label>

      {/* Metadata + action */}
      <div className="mt-3 flex flex-col gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Video title"
          className="rounded-md border border-neutral-900 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-neutral-700"
        />
        <div className="flex items-center gap-2">
          <select
            value={privacy}
            onChange={(e) => setPrivacy(e.target.value as Privacy)}
            className="rounded-md border border-neutral-900 bg-neutral-950 px-2.5 py-2 text-xs text-neutral-300 outline-none focus:border-neutral-700"
          >
            <option value="private">Private</option>
            <option value="unlisted">Unlisted</option>
            <option value="public">Public</option>
          </select>
          <Button
            variant="primary"
            disabled={!file || busy || connected === false}
            onClick={submit}
            className="flex-1"
          >
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Uploading to YouTube…
              </>
            ) : (
              <>
                <YouTubeGlyph size={14} className="text-red-600" />
                Push to YouTube{channel ? ` · ${channel}` : ""}
              </>
            )}
          </Button>
        </div>
      </div>

      {error && (
        <p className="mt-2 font-mono text-[11px] leading-snug text-rose-400/90">{error}</p>
      )}
      {result?.watch_url && (
        <a
          href={result.watch_url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-emerald-900/60 bg-emerald-950/20 px-2.5 py-1.5 font-mono text-[11px] text-emerald-300 transition-colors hover:border-emerald-800"
        >
          <YouTubeGlyph size={12} className="text-red-500" />
          Uploaded — View on YouTube
          <ExternalLink size={10} />
        </a>
      )}
    </SectionCard>
  );
}
