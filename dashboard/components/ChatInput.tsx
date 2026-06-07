"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, Mic, Loader2 } from "lucide-react";
import { toast, dismiss } from "@/components/toast";

interface InputProps {
  inProgress: boolean;
  onSend: (text: string) => Promise<unknown> | unknown;
  isVisible?: boolean;
  onStop?: () => void;
}

// Minimal Web Speech API typing (not in the standard TS DOM lib).
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: any) => void) | null;
  start: () => void;
  stop: () => void;
};

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

// Pick a container the browser can actually record AND Whisper can ingest.
function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const m of candidates) if (MediaRecorder.isTypeSupported(m)) return m;
  return "";
}

/**
 * Voice-to-text strategy:
 *  1. Prefer the Web Speech API when present — it streams live interim text.
 *  2. Fall back to recording the mic (MediaRecorder) and transcribing server-side via
 *     /api/transcribe (OpenAI Whisper). This is what makes Firefox/Brave/Electron work.
 * Every failure path surfaces a toast so the mic never fails silently.
 */
export default function ChatInput({ inProgress, onSend, onStop }: InputProps) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [mediaSupported, setMediaSupported] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const baseTextRef = useRef("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Capability detection (client-only — these APIs are gated on a secure context).
  useEffect(() => {
    setSpeechSupported(!!getSpeechRecognitionCtor());
    setMediaSupported(
      typeof window !== "undefined" &&
        "MediaRecorder" in window &&
        !!navigator.mediaDevices?.getUserMedia,
    );
  }, []);

  // Tear everything down on unmount so the mic indicator never stays lit.
  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* ignore */
      }
      try {
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
          mediaRecorderRef.current.stop();
        }
      } catch {
        /* ignore */
      }
      releaseStream();
    };
  }, []);

  // Auto-grow the textarea up to a cap.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [text]);

  const canVoice = speechSupported || mediaSupported;

  const releaseStream = () => {
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
  };

  const stopVoice = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    recognitionRef.current = null;
    const mr = mediaRecorderRef.current;
    if (mr && mr.state !== "inactive") {
      try {
        mr.stop(); // fires onstop → transcribeChunks
      } catch {
        /* ignore */
      }
    }
    mediaRecorderRef.current = null;
    setListening(false);
  };

  // --- Web Speech path (live interim results) ---
  const startSpeech = () => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      startWhisper();
      return;
    }
    let rec: SpeechRecognitionLike;
    try {
      rec = new Ctor();
    } catch {
      startWhisper();
      return;
    }
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    baseTextRef.current = text ? text.trimEnd() + " " : "";
    rec.onresult = (e: any) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) transcript += e.results[i][0].transcript;
      setText(baseTextRef.current + transcript);
    };
    rec.onerror = (e: any) => {
      const err = e?.error as string | undefined;
      setListening(false);
      recognitionRef.current = null;
      if (err === "aborted") return; // user-initiated stop
      if (err === "no-speech") {
        toast("No speech detected — try again.", "info");
      } else if (err === "not-allowed" || err === "service-not-allowed") {
        toast("Microphone blocked. Allow mic access in your browser settings.", "error");
      } else if (err === "audio-capture") {
        toast("No microphone found.", "error");
      } else if (err === "network" && mediaSupported) {
        // Speech backend unreachable (common in Electron/Brave) — fall back to Whisper.
        toast("Live voice unavailable — switching to server transcription…", "info");
        startWhisper();
      } else {
        toast("Voice input error — try again or type instead.", "error");
      }
    };
    rec.onend = () => setListening(false);
    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
      taRef.current?.focus();
    } catch {
      recognitionRef.current = null;
      if (mediaSupported) startWhisper();
      else toast("Couldn't start voice input.", "error");
    }
  };

  // --- Whisper fallback path (record → /api/transcribe) ---
  const startWhisper = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast("Voice input isn't supported in this browser.", "error");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err: any) {
      const name = err?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        toast("Microphone blocked. Allow mic access for this site, then retry.", "error");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        toast("No microphone found.", "error");
      } else {
        toast("Couldn't access the microphone.", "error");
      }
      return;
    }
    mediaStreamRef.current = stream;
    const mime = pickAudioMime();
    let mr: MediaRecorder;
    try {
      mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    } catch {
      mr = new MediaRecorder(stream);
    }
    chunksRef.current = [];
    mr.ondataavailable = (ev: BlobEvent) => {
      if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
    };
    mr.onstop = () => {
      const type = mr.mimeType || mime || "audio/webm";
      void transcribeChunks(type);
      releaseStream();
    };
    mediaRecorderRef.current = mr;
    try {
      mr.start();
      setListening(true);
      taRef.current?.focus();
    } catch {
      releaseStream();
      mediaRecorderRef.current = null;
      toast("Couldn't start recording.", "error");
    }
  };

  const transcribeChunks = async (mime: string) => {
    const chunks = chunksRef.current;
    chunksRef.current = [];
    if (!chunks.length) return;
    const blob = new Blob(chunks, { type: mime });
    if (blob.size === 0) return;

    setTranscribing(true);
    const tid = toast("Transcribing…", "loading");
    try {
      const fd = new FormData();
      const ext = mime.includes("mp4") ? "mp4" : mime.includes("ogg") ? "ogg" : "webm";
      fd.append("file", blob, `speech.${ext}`);
      const res = await fetch("/api/transcribe", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}) as { text?: string; error?: string });
      dismiss(tid);
      if (!res.ok || data?.error) {
        toast(data?.error || "Transcription failed.", "error");
        return;
      }
      const t = (data?.text || "").trim();
      if (!t) {
        toast("No speech detected — try again.", "info");
        return;
      }
      setText((cur) => (cur && cur.trim() ? cur.trimEnd() + " " : "") + t);
      taRef.current?.focus();
    } catch {
      dismiss(tid);
      toast("Transcription failed — check your connection.", "error");
    } finally {
      setTranscribing(false);
    }
  };

  const toggleVoice = () => {
    if (listening) {
      stopVoice();
      return;
    }
    if (transcribing) return; // already finishing the previous capture
    if (speechSupported) startSpeech();
    else if (mediaSupported) startWhisper();
    else toast("Voice input isn't supported in this browser.", "error");
  };

  const send = () => {
    const value = text.trim();
    if (!value || inProgress) return;
    if (listening) stopVoice();
    onSend(value);
    setText("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const micBusy = listening || transcribing;

  return (
    <div className="px-3 pb-3 pt-1">
      <div className="flex items-end gap-2 rounded-xl border border-neutral-800 bg-neutral-950 p-2 shadow-lg transition-colors focus-within:border-neutral-600">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={
            listening ? "Listening…" : transcribing ? "Transcribing…" : "Ask ClipPilot anything…"
          }
          className="max-h-[140px] flex-1 resize-none border-0 bg-transparent px-1.5 py-1 text-sm leading-relaxed text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-0"
        />

        {canVoice && (
          <button
            type="button"
            onClick={toggleVoice}
            title={
              listening
                ? "Stop voice input"
                : transcribing
                  ? "Transcribing…"
                  : "Voice to text"
            }
            className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
              micBusy
                ? "border-rose-900/60 bg-rose-950/40 text-rose-400"
                : "border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
            }`}
          >
            {listening && (
              <span className="absolute inset-0 animate-ping rounded-lg bg-rose-500/20" />
            )}
            {transcribing ? (
              <Loader2 size={15} className="relative animate-spin" />
            ) : (
              <Mic size={15} className="relative" />
            )}
          </button>
        )}

        {inProgress ? (
          <button
            type="button"
            onClick={onStop}
            title="Stop"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-800 text-neutral-200 transition-colors hover:bg-neutral-700"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={!text.trim()}
            title="Send"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-black transition-all hover:bg-neutral-200 disabled:cursor-default disabled:bg-neutral-800 disabled:text-neutral-600"
          >
            <ArrowUp size={16} />
          </button>
        )}
      </div>
      <p className="mt-1.5 px-1 text-center font-mono text-[10px] text-neutral-700">
        {listening
          ? "recording — speak now, tap the mic to finish"
          : transcribing
            ? "transcribing your audio…"
            : "Enter to send · Shift+Enter for newline"}
      </p>
    </div>
  );
}
