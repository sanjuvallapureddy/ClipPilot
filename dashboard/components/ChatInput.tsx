"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, Mic } from "lucide-react";

interface InputProps {
  inProgress: boolean;
  onSend: (text: string) => Promise<unknown> | unknown;
  isVisible?: boolean;
  onStop?: () => void;
}

// Minimal Web Speech API typing (not in standard TS DOM lib).
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

export default function ChatInput({ inProgress, onSend, onStop }: InputProps) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const [supportsVoice, setSupportsVoice] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseTextRef = useRef("");
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const SR =
      (typeof window !== "undefined" &&
        ((window as any).SpeechRecognition ||
          (window as any).webkitSpeechRecognition)) ||
      null;
    setSupportsVoice(!!SR);
  }, []);

  // Auto-grow the textarea up to a cap.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [text]);

  const stopListening = () => {
    recognitionRef.current?.stop();
    setListening(false);
  };

  const toggleVoice = () => {
    if (listening) {
      stopListening();
      return;
    }
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec: SpeechRecognitionLike = new SR();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    baseTextRef.current = text ? text.trimEnd() + " " : "";
    rec.onresult = (e: any) => {
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      setText(baseTextRef.current + transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
    taRef.current?.focus();
  };

  const send = () => {
    const value = text.trim();
    if (!value || inProgress) return;
    if (listening) stopListening();
    onSend(value);
    setText("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="px-3 pb-3 pt-1">
      <div className="flex items-end gap-2 rounded-xl border border-neutral-800 bg-neutral-950 p-2 shadow-lg transition-colors focus-within:border-neutral-600">
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={listening ? "Listening…" : "Ask ClipPilot anything…"}
          className="max-h-[140px] flex-1 resize-none border-0 bg-transparent px-1.5 py-1 text-sm leading-relaxed text-neutral-100 placeholder:text-neutral-600 focus:outline-none focus:ring-0"
        />

        {supportsVoice && (
          <button
            type="button"
            onClick={toggleVoice}
            title={listening ? "Stop voice input" : "Voice to text"}
            className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
              listening
                ? "border-rose-900/60 bg-rose-950/40 text-rose-400"
                : "border-neutral-800 bg-neutral-900 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
            }`}
          >
            {listening && (
              <span className="absolute inset-0 animate-ping rounded-lg bg-rose-500/20" />
            )}
            <Mic size={15} className="relative" />
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
        {listening ? "recording — speak now" : "Enter to send · Shift+Enter for newline"}
      </p>
    </div>
  );
}
