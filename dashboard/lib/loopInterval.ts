const STORAGE_KEY = "clippilot:loop-interval-seconds";

export const LOOP_INTERVAL_OPTIONS = [
  { label: "15 minutes", seconds: 15 * 60 },
  { label: "30 minutes", seconds: 30 * 60 },
  { label: "60 minutes", seconds: 60 * 60 },
  { label: "2 hours", seconds: 2 * 60 * 60 },
] as const;

export const DEFAULT_INTERVAL_SECONDS = 30 * 60;

export function getLoopIntervalSeconds(): number {
  if (typeof window === "undefined") return DEFAULT_INTERVAL_SECONDS;
  const raw = localStorage.getItem(STORAGE_KEY);
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 60) return n;
  return DEFAULT_INTERVAL_SECONDS;
}

export function setLoopIntervalSeconds(seconds: number): void {
  localStorage.setItem(STORAGE_KEY, String(seconds));
  window.dispatchEvent(new CustomEvent("clippilot:loop-interval", { detail: seconds }));
}

export function formatInterval(seconds: number): string {
  if (seconds >= 3600 && seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds}s`;
}
