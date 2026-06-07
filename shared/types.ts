// ClipPilot payload schemas — TypeScript mirror of `shared/schemas.py`.
// Keep in sync. Any contract change -> post to coord:log + update CLAUDE.md (§6).

// ----- Redis key contract (mirror of shared/keys.py) -----
export const KEYS = {
  DISCOVERY_QUEUE: "discovery:queue",
  JOBS_STREAM: "jobs:stream",
  PATTERNS_CURRENT: "patterns:current",
  RESULTS_SET: "results:all",
  INSIGHTS_LATEST: "insights:latest",
  INSIGHTS_STREAM: "insights:stream",
  COORD_LOG: "coord:log",
  CHAT_STREAM: "chat:stream",
  TRENDS_INDEX: "idx:trends",
} as const;

export const seenKey = (videoId: string) => `seen:${videoId}`;
export const jobKey = (jobId: string) => `jobs:${jobId}`;
export const resultKey = (clipId: string) => `results:${clipId}`;
export const variantsKey = (topic: string) => `patterns:variants:${topic}`;
export const trendKey = (id: string) => `trend:${id}`;

export const STAGES = [
  "queued",
  "fetching",
  "transcribing",
  "analyzing",
  "done",
  "failed",
] as const;
export type Stage = (typeof STAGES)[number];

export const PLATFORMS = ["tiktok", "instagram", "youtube"] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface DiscoveryItem {
  youtube_url: string;
  title: string;
  podcast: string;
  topic: string;
  published_at: string;
  trend_score: number;
  source: string;
}

export interface Job {
  job_id: string;
  episode_url: string;
  stage: Stage;
  status: string;
  retries: number;
  title: string;
  topic: string;
  engine_job_id: string;
  created_at: number;
  updated_at: number;
  error: string;
}

export interface JobEvent {
  job_id: string;
  stage: Stage;
  status: string;
  title: string;
  message: string;
  ts: number;
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
  render_status: string; // pending | rendered
  post_status: string; // not_posted | posted
  views: number;
  likes: number;
  shares: number;
  watch_time: number;
  engagement_score: number; // GPT predicted virality until real metrics land
}

export interface Patterns {
  winning_topics: string[];
  hook_templates: string[];
  ideal_length_min: number;
  ideal_length_max: number;
  caption_style: string;
  summary: string;
  // self-learning fields (set by performance/insights.py)
  hook_style: string;
  first_line_strategy: string;
  avoid_topics: string[];
  insight_summary: string;
  updated_at: number;
}

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
  applied: string[]; // recs auto-written to patterns:current
  confidence: number;
  created_at: number;
}

export interface Variant {
  variant_id: string;
  title: string;
  caption: string;
  hook: string;
  thumbnail_prompt: string;
}

export interface VariantSet {
  topic: string;
  variants: Variant[];
  updated_at: number;
}

export interface CoordMessage {
  lane: string;
  kind: string;
  message: string;
  ts: number;
}

// ----- Team chat / agent "Slack" (mirror of shared/schemas.py ChatMessage) -----
export interface ChatMessage {
  id?: string; // redis stream id, attached when read back by the dashboard SSE route
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
  lane: string; // A | B | C | D
  role: string;
}

// Mirror of keys.AGENTS — the four peers (no orchestrator of the conversation).
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
