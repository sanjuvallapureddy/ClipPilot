// anim-controller — the brain for the (currently MOCK) editing animation.
//
// WHAT THIS IS TODAY
// ------------------
// This module is the single source of truth for the fake "we're editing your clip"
// timeline the GUI plays. It does NOT touch the video. It just describes a believable
// sequence of editing stages + operations (captions, cuts, reframe, effects, render) and
// how long each should appear to take. The GUI (MockEditingStudio.tsx) reads this and
// animates accordingly, then drops the ORIGINAL clip into the final box unchanged.
//
// WHAT THIS BECOMES LATER
// -----------------------
// This is the seam where real editing intelligence will plug in. In the future the
// controller will pull cues from the OpenShorts repo (https://github.com/mutonby/openshorts)
// — real caption timings, detected jump-cut points, 9:16 reframe / face-track keyframes,
// effect + hook markers — and translate them into the exact same EditStage[] shape returned
// below. Because the GUI only depends on this shape, the visuals won't have to change when
// we swap the mock data for real OpenShorts-driven cues. See `getEditTimeline()`'s note.
//
// Keep this framework-agnostic (no React / no lucide imports) so it can be reused by a
// headless runner later — the GUI maps the string `icon` keys to actual icons itself.

export type EditOpKind =
  | "ingest"
  | "caption"
  | "cut"
  | "reframe"
  | "effect"
  | "audio"
  | "hook"
  | "render";

export interface EditOp {
  /** Stable id (also used as React key). */
  id: string;
  /** Human label shown on the operation chip. */
  label: string;
  /** Category — drives the chip icon/colour in the GUI. */
  kind: EditOpKind;
}

export type StageAccent = "neutral" | "violet" | "sky" | "amber" | "emerald";

export interface EditStage {
  id: string;
  /** Short title shown on the stage node, e.g. "Captions". */
  title: string;
  /** One-line description of what this stage is "doing". */
  blurb: string;
  /** Icon key the GUI maps to a lucide icon. */
  icon: string;
  /** Accent colour theme for this stage. */
  accent: StageAccent;
  /** How long (ms) this stage should appear to run. */
  durationMs: number;
  /** The operations that tick off while this stage runs. */
  ops: EditOp[];
}

// --- The mock timeline ------------------------------------------------------------------
// Mirrors a real short-form edit: ingest → transcribe/caption → cut & reframe → punch-up
// with effects → final render. Durations are tuned so the whole thing reads as ~9s of
// "work" — long enough to feel real, short enough not to bore.
const MOCK_TIMELINE: EditStage[] = [
  {
    id: "ingest",
    title: "Raw clip",
    blurb: "Reading your source clip…",
    icon: "film",
    accent: "neutral",
    durationMs: 1200,
    ops: [
      { id: "ingest-load", label: "Source ingested", kind: "ingest" },
      { id: "ingest-scan", label: "Scanning frames", kind: "ingest" },
    ],
  },
  {
    id: "captions",
    title: "Captions",
    blurb: "Transcribing speech & styling captions…",
    icon: "captions",
    accent: "violet",
    durationMs: 2000,
    ops: [
      { id: "cap-transcribe", label: "Transcribe audio", kind: "caption" },
      { id: "cap-style", label: "Style word-by-word captions", kind: "caption" },
      { id: "cap-sync", label: "Sync caption timing", kind: "caption" },
    ],
  },
  {
    id: "cuts",
    title: "Cuts & reframe",
    blurb: "Trimming dead air & reframing to 9:16…",
    icon: "scissors",
    accent: "sky",
    durationMs: 2200,
    ops: [
      { id: "cut-silence", label: "Trim silences", kind: "cut" },
      { id: "cut-jump", label: "Add jump cuts", kind: "cut" },
      { id: "cut-reframe", label: "Reframe to 9:16", kind: "reframe" },
      { id: "cut-face", label: "Face-track subject", kind: "reframe" },
    ],
  },
  {
    id: "effects",
    title: "Effects",
    blurb: "Punch-ins, b-roll, sound design & hook…",
    icon: "sparkles",
    accent: "amber",
    durationMs: 2200,
    ops: [
      { id: "fx-zoom", label: "Zoom punch-ins", kind: "effect" },
      { id: "fx-broll", label: "Drop b-roll", kind: "effect" },
      { id: "fx-sfx", label: "Sound effects", kind: "audio" },
      { id: "fx-hook", label: "Hook overlay", kind: "hook" },
    ],
  },
  {
    id: "render",
    title: "Final render",
    blurb: "Colour grade & export…",
    icon: "clapperboard",
    accent: "emerald",
    durationMs: 1400,
    ops: [
      { id: "rn-color", label: "Colour grade", kind: "effect" },
      { id: "rn-export", label: "Export 1080×1920", kind: "render" },
    ],
  },
];

/**
 * Returns the editing stage timeline the GUI should animate.
 *
 * TODAY: returns the hardcoded mock above (no real editing happens).
 *
 * FUTURE: this will accept the OpenShorts job result and build the same EditStage[] from
 * REAL cues — e.g. map detected cut points to "cut" ops, caption segments to "caption"
 * ops, reframe keyframes to "reframe" ops — so the animation reflects the actual edit.
 * Signature is intentionally arg-less for now; we'll add an optional `cues` param later
 * without breaking callers.
 */
export function getEditTimeline(): EditStage[] {
  // Return copies so the GUI can mutate per-run state (e.g. op completion) safely.
  return MOCK_TIMELINE.map((s) => ({ ...s, ops: s.ops.map((o) => ({ ...o })) }));
}

/** Total wall-clock duration (ms) of the whole mock edit. */
export function totalDurationMs(stages: EditStage[] = getEditTimeline()): number {
  return stages.reduce((sum, s) => sum + s.durationMs, 0);
}

/**
 * Given elapsed time (ms) since the edit started, compute what the GUI should show:
 * which stage is active, overall progress 0..1, and how many ops in the active stage are
 * done. Pure function so it's trivial to drive from requestAnimationFrame (and to test).
 */
export function timelineStateAt(
  elapsedMs: number,
  stages: EditStage[],
): {
  activeIndex: number;
  /** 0..1 across the whole timeline. */
  progress: number;
  /** number of completed ops within the active stage. */
  opsDone: number;
  /** true once elapsed has passed the end of the timeline. */
  finished: boolean;
} {
  const total = totalDurationMs(stages);
  const clamped = Math.max(0, Math.min(elapsedMs, total));
  const progress = total === 0 ? 1 : clamped / total;

  let acc = 0;
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const start = acc;
    const end = acc + stage.durationMs;
    if (clamped < end || i === stages.length - 1) {
      const within = Math.max(0, clamped - start);
      const frac = stage.durationMs === 0 ? 1 : within / stage.durationMs;
      const opsDone = Math.min(
        stage.ops.length,
        Math.floor(frac * stage.ops.length + 0.0001),
      );
      return {
        activeIndex: i,
        progress,
        opsDone,
        finished: elapsedMs >= total,
      };
    }
    acc = end;
  }
  return { activeIndex: 0, progress, opsDone: 0, finished: elapsedMs >= total };
}
