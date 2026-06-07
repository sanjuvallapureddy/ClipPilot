// Mirror of shared/types.ts (kept local so the Next build is self-contained).
// Source of truth: ../../shared/types.ts + ../../shared/schemas.py.
export type Stage =
  | "queued" | "fetching" | "transcribing" | "analyzing" | "done" | "failed";

export interface JobEvent {
  job_id: string;
  stage: Stage;
  status: string;
  title: string;
  message: string;
  ts: number;
}

export interface Job {
  job_id: string;
  episode_url: string;
  stage: Stage;
  status: string;
  title: string;
  topic: string;
  engine_job_id: string;
  updated_at: number;
  error: string;
}

export interface DiscoveryItem {
  youtube_url: string;
  title: string;
  podcast: string;
  topic: string;
  trend_score: number;
  source: string;
}

export interface ClipResult {
  clip_id: string;
  job_id: string;
  source_url: string;
  clip_url: string;
  platform: string;
  post_id: string;
  posted_at: string;
  title: string;
  topic: string;
  hook: string;
  quote: string;
  reason: string;
  start_seconds: number;
  end_seconds: number;
  length_seconds: number;
  render_status: string;
  post_status: string;
  views: number;
  likes: number;
  shares: number;
  engagement_score: number;
  created_at: number;
  updated_at: number;
}

export interface Patterns {
  winning_topics: string[];
  hook_templates: string[];
  ideal_length_min: number;
  ideal_length_max: number;
  caption_style: string;
  summary: string;
  // self-learning fields (set by performance/insights.py)
  hook_style?: string;
  first_line_strategy?: string;
  avoid_topics?: string[];
  insight_summary?: string;
}

// Mirror of shared/schemas.py LearningInsight — one self-learning comparison.
export interface LearningInsight {
  insight_id: string;
  winner_clip_id: string;
  loser_clip_id: string;
  signal_source: string; // real_views | predicted_virality
  winner_signal: number;
  loser_signal: number;
  why: string;
  factors: string[];
  recommendations: string[];
  applied: string[];
  confidence: number;
  created_at: number;
}

// --- Team chat (agent "Slack") — mirror of shared/schemas.py ChatMessage ---
export interface ChatMessage {
  id?: string; // redis stream id, attached by the SSE route
  author: string; // agent id (see AGENTS)
  channel: string; // channel name or "dm:<a>-<b>"
  text: string;
  mentions: string[]; // agent ids
  in_reply_to: string; // thread root stream id
  kind: string; // chat | event
  ts: number;
}

export interface AgentMeta {
  name: string;
  emoji: string;
  lane: string;
  role: string;
}

export const AGENTS: Record<string, AgentMeta> = {
  scout: { name: "Scout", emoji: "🛰️", lane: "A", role: "discovery" },
  cutter: { name: "Cutter", emoji: "✂️", lane: "C", role: "engine" },
  coach: { name: "Coach", emoji: "📈", lane: "B", role: "performance" },
  pilot: { name: "Pilot", emoji: "🎬", lane: "D", role: "copilot" },
};

export const CHANNELS = [
  "general",
  "discovery",
  "editing",
  "performance",
  "activity",
] as const;
