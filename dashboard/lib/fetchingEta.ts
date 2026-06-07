/** Client-side heuristics for fetching stage duration (UI only — no backend/download changes). */

const SEGMENT_DOWNLOAD_RE =
  /downloading source segment ([\d.]+)[–-]([\d.]+)m/i;
const SELECTING_SEGMENT_RE = /selecting best ([\d.]+)m (?:window|segment)/i;
const SOURCE_DURATION_RE = /source is ([\d.]+)m/i;
// "most-replayed: 3 peaks similar; grabbing 3×2.0m windows"
const MULTI_PEAK_RE = /most-replayed: (\d+) peaks similar/i;

/** Rough total seconds we expect for the current fetching sub-step. */
export function estimateFetchingSeconds(message: string): number {
  const msg = message.trim().toLowerCase();

  const segment = msg.match(SEGMENT_DOWNLOAD_RE);
  if (segment) {
    const startMin = parseFloat(segment[1]);
    const endMin = parseFloat(segment[2]);
    const segmentMin = Math.max(1, endMin - startMin);
    // yt-dlp section cuts: ~12–20s per minute of source; use a conservative mid estimate.
    return Math.round(60 + segmentMin * 14);
  }

  const multiPeak = msg.match(MULTI_PEAK_RE);
  if (multiPeak) {
    // Each near-equal peak is its own ~2m window download, then a quick ffmpeg concat.
    const peaks = Math.max(1, parseInt(multiPeak[1], 10) || 1);
    return Math.round(peaks * 90 + 30);
  }
  if (msg.includes("merging") && msg.includes("most-replayed windows")) return 30;

  if (SELECTING_SEGMENT_RE.test(msg)) return 75;
  if (msg.includes("finding most-replayed peak")) return 20;
  // Secondary transcript pass: fetch captions once + score peaks (heatmap stays primary).
  if (msg.includes("ranking peaks by transcript")) return 25;
  if (msg.includes("skipping music-only")) return 8;
  if (msg.includes("most-replayed peak at")) return 100;
  if (msg.includes("current stage: fetching")) return 420;
  if (msg.includes("checking source video")) return 25;
  if (msg.includes("submitting source video")) return 35;
  if (msg.includes("openshorts downloading")) return 210;
  if (msg.includes("openshorts queued") || msg.includes("openshorts processing")) return 120;
  if (msg.includes("openshorts job") && msg.includes("accepted")) return 90;

  const source = msg.match(SOURCE_DURATION_RE);
  if (source) {
    const minutes = parseFloat(source[1]);
    if (minutes <= 30) return Math.round(90 + minutes * 4);
    return Math.round(120 + Math.min(minutes, 30) * 10);
  }

  return 240;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r > 0 ? `${m}m ${r}s` : `${m}m`;
}

export function fetchingEtaLabel(
  elapsedSec: number,
  estimateSec: number,
): { elapsed: string; remaining: string; pct: number } {
  const pct = Math.min(95, Math.round((elapsedSec / Math.max(estimateSec, 1)) * 100));
  const remaining = Math.max(0, estimateSec - elapsedSec);
  let remainingLabel: string;
  if (elapsedSec > estimateSec * 1.15) {
    remainingLabel = "taking longer than usual…";
  } else if (remaining > 0) {
    remainingLabel = `~${formatDuration(remaining)} left`;
  } else {
    remainingLabel = "finishing up…";
  }
  return {
    elapsed: formatDuration(elapsedSec),
    remaining: remainingLabel,
    pct,
  };
}
