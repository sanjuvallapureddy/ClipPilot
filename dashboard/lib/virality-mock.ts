// Mock virality predictions for multiple clips (Lane D).
//
// TODAY: hardcoded believable scores, retention curves, factor breakdowns, and copilot-style
// reasoning. No real OpenShorts output yet.
//
// FUTURE: OpenShorts will produce multiple rendered clips per job; replace getClipPredictions()
// to map real clip metadata + GPT scores + (eventually) post metrics into this same shape.
// The ViralityPredictor UI and Copilot readables only depend on ClipViralityPrediction[].

export interface ViralityFactor {
  id: string;
  label: string;
  /** 0–100 contribution to the overall virality score. */
  score: number;
  color: string;
}

export interface CurvePoint {
  second: number;
  /** 0–100 */
  value: number;
}

export interface ClipViralityPrediction {
  clip_id: string;
  title: string;
  hook: string;
  topic: string;
  length_seconds: number;
  /** 0–100 overall predicted virality. */
  virality_score: number;
  rank: number;
  predicted_views: number;
  predicted_likes: number;
  predicted_shares: number;
  /** Average % of viewers still watching at end. */
  predicted_retention_pct: number;
  /** Model confidence 0–100. */
  confidence: number;
  factors: ViralityFactor[];
  retention_curve: CurvePoint[];
  /** Predicted engagement intensity over the clip timeline. */
  engagement_curve: CurvePoint[];
  /** One-paragraph summary for the UI + copilot. */
  reasoning: string;
  /** Bullet points the copilot can cite when explaining WHY. */
  why_bullets: string[];
}

const FACTOR_COLORS = {
  hook: "#a78bfa",
  pacing: "#38bdf8",
  controversy: "#fb7185",
  relatability: "#34d399",
  audio: "#fbbf24",
  payoff: "#f472b6",
} as const;

function curve(
  length: number,
  shape: "hook_spike" | "steady" | "late_peak",
): { retention: CurvePoint[]; engagement: CurvePoint[] } {
  const steps = Math.min(24, Math.max(12, Math.round(length / 2)));
  const retention: CurvePoint[] = [];
  const engagement: CurvePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const sec = Math.round(t * length);
    let ret = 100;
    let eng = 40;
    if (shape === "hook_spike") {
      ret = 100 - t * 38 - Math.exp(-t * 8) * 5;
      eng = 55 + Math.exp(-((t - 0.08) ** 2) / 0.008) * 40 - t * 25;
    } else if (shape === "steady") {
      ret = 100 - t * 32;
      eng = 48 + Math.sin(t * Math.PI) * 18;
    } else {
      ret = 100 - t * 28 - (t > 0.7 ? (t - 0.7) * 20 : 0);
      eng = 42 + (t > 0.55 ? (t - 0.55) * 90 : 0);
    }
    retention.push({ second: sec, value: Math.max(12, Math.min(100, ret)) });
    engagement.push({ second: sec, value: Math.max(8, Math.min(98, eng)) });
  }
  return { retention, engagement };
}

const MOCK_CLIPS: Omit<ClipViralityPrediction, "rank">[] = [
  {
    clip_id: "clip_mock_01",
    title: "He said WHAT about AI taking jobs?",
    hook: "Wait until you hear this take…",
    topic: "tech",
    length_seconds: 42,
    virality_score: 91,
    predicted_views: 284000,
    predicted_likes: 18200,
    predicted_shares: 4100,
    predicted_retention_pct: 68,
    confidence: 87,
    factors: [
      { id: "hook", label: "Hook strength", score: 94, color: FACTOR_COLORS.hook },
      { id: "pacing", label: "Pacing", score: 82, color: FACTOR_COLORS.pacing },
      { id: "controversy", label: "Controversy", score: 96, color: FACTOR_COLORS.controversy },
      { id: "relatability", label: "Relatability", score: 78, color: FACTOR_COLORS.relatability },
      { id: "audio", label: "Audio energy", score: 88, color: FACTOR_COLORS.audio },
      { id: "payoff", label: "Payoff", score: 85, color: FACTOR_COLORS.payoff },
    ],
    ...(() => {
      const { retention, engagement } = curve(42, "hook_spike");
      return { retention_curve: retention, engagement_curve: engagement };
    })(),
    reasoning:
      "This clip opens with a pattern-interrupt hook and escalates into a contrarian AI-jobs take " +
      "within the first 3 seconds — the highest-retention window on Shorts. Controversy score is " +
      "in the top decile for your tech corpus, and the speaker's vocal inflection spikes right before " +
      "the quotable line, which models correlate with share velocity.",
    why_bullets: [
      "Hook lands before 3s — viewers don't scroll past the pattern interrupt.",
      "Contrarian framing ('AI won't replace you, but…') triggers comment debate.",
      "Audio energy peaks at 0:08 right before the money quote — retention holds 68% to the end.",
      "Length (42s) sits inside learned winning band 35–55s for tech topics.",
      "Payoff is self-contained; no prior podcast context required.",
    ],
  },
  {
    clip_id: "clip_mock_02",
    title: "The networking advice nobody tells you",
    hook: "Stop sending cold DMs",
    topic: "business",
    length_seconds: 38,
    virality_score: 84,
    predicted_views: 198000,
    predicted_likes: 12400,
    predicted_shares: 2800,
    predicted_retention_pct: 61,
    confidence: 82,
    factors: [
      { id: "hook", label: "Hook strength", score: 86, color: FACTOR_COLORS.hook },
      { id: "pacing", label: "Pacing", score: 88, color: FACTOR_COLORS.pacing },
      { id: "controversy", label: "Controversy", score: 72, color: FACTOR_COLORS.controversy },
      { id: "relatability", label: "Relatability", score: 92, color: FACTOR_COLORS.relatability },
      { id: "audio", label: "Audio energy", score: 76, color: FACTOR_COLORS.audio },
      { id: "payoff", label: "Payoff", score: 80, color: FACTOR_COLORS.payoff },
    ],
    ...(() => {
      const { retention, engagement } = curve(38, "steady");
      return { retention_curve: retention, engagement_curve: engagement };
    })(),
    reasoning:
      "High relatability drives saves and shares in business niches. The hook is direct advice " +
      "(negative framing) which outperforms generic tips. Pacing is even with no dead air, but " +
      "controversy is moderate — strong performer, not the viral outlier.",
    why_bullets: [
      "Actionable hook ('Stop sending cold DMs') — viewers self-identify immediately.",
      "Steady pacing with no silence gaps; retention decay is linear, not cliff-shaped.",
      "Relatability score 92 — strongest factor; good for reposts to LinkedIn/TikTok business.",
      "Slightly lower controversy vs #1 — fewer comment fights, more saves.",
    ],
  },
  {
    clip_id: "clip_mock_03",
    title: "This founder lost everything — then 10x'd",
    hook: "I was down to $400 in my account",
    topic: "startup",
    length_seconds: 55,
    virality_score: 79,
    predicted_views: 156000,
    predicted_likes: 9800,
    predicted_shares: 1900,
    predicted_retention_pct: 54,
    confidence: 76,
    factors: [
      { id: "hook", label: "Hook strength", score: 90, color: FACTOR_COLORS.hook },
      { id: "pacing", label: "Pacing", score: 70, color: FACTOR_COLORS.pacing },
      { id: "controversy", label: "Controversy", score: 58, color: FACTOR_COLORS.controversy },
      { id: "relatability", label: "Relatability", score: 85, color: FACTOR_COLORS.relatability },
      { id: "audio", label: "Audio energy", score: 72, color: FACTOR_COLORS.audio },
      { id: "payoff", label: "Payoff", score: 88, color: FACTOR_COLORS.payoff },
    ],
    ...(() => {
      const { retention, engagement } = curve(55, "late_peak");
      return { retention_curve: retention, engagement_curve: engagement };
    })(),
    reasoning:
      "Story arc clip: vulnerability hook is strong, but the payoff lands late (second half). " +
      "Retention dips mid-clip before the turnaround — classic narrative shape. Best for audiences " +
      "who already follow founder content; slightly long for cold traffic.",
    why_bullets: [
      "Vulnerability hook ('$400 in my account') — high emotional pull in first 2s.",
      "Payoff delayed to 0:32 — engagement spikes late but mid-clip drop hurts avg retention.",
      "55s exceeds ideal 35–45s band for cold Shorts traffic.",
      "Strong payoff once turnaround hits — good for serialized follow-up clips.",
    ],
  },
  {
    clip_id: "clip_mock_04",
    title: "Scientists react to that viral health claim",
    hook: "That's actually backwards",
    topic: "health",
    length_seconds: 31,
    virality_score: 73,
    predicted_views: 112000,
    predicted_likes: 7200,
    predicted_shares: 1400,
    predicted_retention_pct: 58,
    confidence: 71,
    factors: [
      { id: "hook", label: "Hook strength", score: 78, color: FACTOR_COLORS.hook },
      { id: "pacing", label: "Pacing", score: 84, color: FACTOR_COLORS.pacing },
      { id: "controversy", label: "Controversy", score: 80, color: FACTOR_COLORS.controversy },
      { id: "relatability", label: "Relatability", score: 62, color: FACTOR_COLORS.relatability },
      { id: "audio", label: "Audio energy", score: 68, color: FACTOR_COLORS.audio },
      { id: "payoff", label: "Payoff", score: 74, color: FACTOR_COLORS.payoff },
    ],
    ...(() => {
      const { retention, engagement } = curve(31, "hook_spike");
      return { retention_curve: retention, engagement_curve: engagement };
    })(),
    reasoning:
      "Myth-bust format performs on health TikTok. Hook debunks a trending claim — controversy " +
      "is solid but relatability is niche (assumes viewer saw the original viral claim). Short " +
      "length helps; would benefit from on-screen text citing the claim being debunked.",
    why_bullets: [
      "Debunk framing rides algorithmic tail of the original viral claim.",
      "31s length is optimal for health Shorts — full watch-through likely.",
      "Relatability lower — needs caption/context overlay for cold viewers.",
    ],
  },
  {
    clip_id: "clip_mock_05",
    title: "Room went silent after this question",
    hook: "Can I ask you something uncomfortable?",
    topic: "culture",
    length_seconds: 47,
    virality_score: 88,
    predicted_views: 241000,
    predicted_likes: 16800,
    predicted_shares: 3600,
    predicted_retention_pct: 64,
    confidence: 84,
    factors: [
      { id: "hook", label: "Hook strength", score: 92, color: FACTOR_COLORS.hook },
      { id: "pacing", label: "Pacing", score: 80, color: FACTOR_COLORS.pacing },
      { id: "controversy", label: "Controversy", score: 90, color: FACTOR_COLORS.controversy },
      { id: "relatability", label: "Relatability", score: 74, color: FACTOR_COLORS.relatability },
      { id: "audio", label: "Audio energy", score: 86, color: FACTOR_COLORS.audio },
      { id: "payoff", label: "Payoff", score: 91, color: FACTOR_COLORS.payoff },
    ],
    ...(() => {
      const { retention, engagement } = curve(47, "late_peak");
      return { retention_curve: retention, engagement_curve: engagement };
    })(),
    reasoning:
      "Tension-and-release structure: the uncomfortable question creates a hold pattern, then the " +
      "room reaction is the payoff. High controversy + payoff scores. Audio dip-then-spike mirrors " +
      "retention — viewers wait for the answer.",
    why_bullets: [
      "Open-loop hook ('something uncomfortable') — viewers stay for the answer.",
      "Payoff score 91 — the silence + reaction is the shareable moment.",
      "Controversy 90 — comment-section fuel without being policy-risky.",
      "Second-best overall; post clip #1 if you want max reach, this if you want max shares.",
    ],
  },
];

/** All mock clip predictions, sorted by virality (best first). */
export function getClipPredictions(): ClipViralityPrediction[] {
  const sorted = [...MOCK_CLIPS].sort((a, b) => b.virality_score - a.virality_score);
  return sorted.map((c, i) => ({ ...c, rank: i + 1 }));
}

export function getBestPrediction(): ClipViralityPrediction {
  return getClipPredictions()[0];
}

export function getPredictionById(id: string): ClipViralityPrediction | undefined {
  return getClipPredictions().find((c) => c.clip_id === id);
}

/** Aggregate factor weights across all clips (for comparison pie). */
export function aggregateFactorMix(
  clips: ClipViralityPrediction[] = getClipPredictions(),
): ViralityFactor[] {
  const totals = new Map<string, { label: string; score: number; color: string; n: number }>();
  for (const clip of clips) {
    for (const f of clip.factors) {
      const cur = totals.get(f.id) || { label: f.label, score: 0, color: f.color, n: 0 };
      cur.score += f.score;
      cur.n += 1;
      totals.set(f.id, cur);
    }
  }
  return [...totals.entries()].map(([id, v]) => ({
    id,
    label: v.label,
    score: Math.round(v.score / v.n),
    color: v.color,
  }));
}
