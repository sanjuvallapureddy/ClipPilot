// Mirror of shared/types.ts (kept local so the Next build is self-contained).
// Source of truth: ../../shared/types.ts + ../../shared/schemas.py.
export type Stage =
  | "queued" | "submitted" | "rendering" | "publishing" | "done" | "failed";

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
  clip_url: string;
  platform: string;
  post_id: string;
  posted_at: string;
  title: string;
  topic: string;
  hook: string;
  length_seconds: number;
  views: number;
  likes: number;
  shares: number;
  engagement_score: number;
}

export interface Patterns {
  winning_topics: string[];
  hook_templates: string[];
  ideal_length_min: number;
  ideal_length_max: number;
  caption_style: string;
  summary: string;
}
