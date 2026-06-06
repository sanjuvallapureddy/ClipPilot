// ClipPilot payload schemas — TypeScript mirror of `shared/schemas.py`.
// Keep in sync. Any contract change -> post to coord:log + update CLAUDE.md (§6).

// ----- Redis key contract (mirror of shared/keys.py) -----
export const KEYS = {
  DISCOVERY_QUEUE: "discovery:queue",
  JOBS_STREAM: "jobs:stream",
  PATTERNS_CURRENT: "patterns:current",
  RESULTS_SET: "results:all",
  COORD_LOG: "coord:log",
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
  updated_at: number;
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
