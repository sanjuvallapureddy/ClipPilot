"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  AlertTriangle,
  Info,
  Loader2,
  type LucideIcon,
} from "lucide-react";

type ToastVariant = "success" | "error" | "info" | "loading";

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  duration: number;
}

const icons: Record<ToastVariant, LucideIcon> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
  loading: Loader2,
};

const accent: Record<ToastVariant, string> = {
  success: "text-emerald-400",
  error: "text-rose-400",
  info: "text-neutral-400",
  loading: "text-neutral-400",
};

const barColor: Record<ToastVariant, string> = {
  success: "bg-emerald-500/60",
  error: "bg-rose-500/60",
  info: "bg-neutral-600",
  loading: "bg-neutral-700",
};

// Module-level pub/sub so any component can fire a toast without context wiring.
let listeners: ((toasts: ToastItem[]) => void)[] = [];
let toasts: ToastItem[] = [];
let seq = 0;

function emit() {
  for (const l of listeners) l([...toasts]);
}

export function toast(
  message: string,
  variant: ToastVariant = "info",
  duration = 3200,
) {
  const id = ++seq;
  toasts = [...toasts, { id, message, variant, duration }];
  emit();
  if (variant !== "loading") {
    setTimeout(() => dismiss(id), duration);
  }
  return id;
}

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    listeners.push(setItems);
    setItems([...toasts]);
    return () => {
      listeners = listeners.filter((l) => l !== setItems);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2">
      <AnimatePresence initial={false}>
        {items.map((t) => {
          const Icon = icons[t.variant];
          const showBar = t.variant !== "loading";
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={{ left: 0, right: 0.9 }}
              onDragEnd={(_, info) => {
                if (info.offset.x > 60) dismiss(t.id);
              }}
              onClick={() => dismiss(t.id)}
              className="pointer-events-auto relative flex min-w-[220px] max-w-[320px] cursor-pointer items-center gap-2 overflow-hidden rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-200 shadow-2xl"
            >
              <Icon
                size={14}
                className={`shrink-0 ${accent[t.variant]} ${
                  t.variant === "loading" ? "animate-spin" : ""
                }`}
              />
              <span className="truncate">{t.message}</span>
              {showBar && (
                <motion.span
                  className={`absolute bottom-0 left-0 h-0.5 ${barColor[t.variant]}`}
                  initial={{ width: "100%" }}
                  animate={{ width: "0%" }}
                  transition={{ duration: t.duration / 1000, ease: "linear" }}
                />
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
