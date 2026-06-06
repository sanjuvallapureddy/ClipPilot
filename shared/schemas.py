"""ClipPilot payload schemas (pydantic v2). Mirror of `shared/types.ts`.

These define the *shape* of every payload that crosses the Redis contract (§4).
Redis Streams/Hashes store flat string fields, so each model provides
`to_redis()` (flatten -> dict[str,str]) and `from_redis()` helpers.
"""
from __future__ import annotations

import json
import time
from typing import Any, Optional

from pydantic import BaseModel, Field


def _now() -> float:
    return time.time()


def _flatten(d: dict[str, Any]) -> dict[str, str]:
    """Flatten a dict to str->str for Redis hash/stream storage."""
    out: dict[str, str] = {}
    for k, v in d.items():
        if v is None:
            out[k] = ""
        elif isinstance(v, (dict, list)):
            out[k] = json.dumps(v)
        elif isinstance(v, bool):
            out[k] = "1" if v else "0"
        else:
            out[k] = str(v)
    return out


class DiscoveryItem(BaseModel):
    """Field set for the `discovery:queue` stream (§4)."""

    youtube_url: str
    title: str
    podcast: str = ""
    topic: str = ""
    published_at: str = ""  # ISO8601
    trend_score: float = 0.0
    source: str = "youtube"  # youtube | listennotes | seed

    def to_redis(self) -> dict[str, str]:
        return _flatten(self.model_dump())

    @classmethod
    def from_redis(cls, d: dict[str, Any]) -> "DiscoveryItem":
        d = {k: (v.decode() if isinstance(v, bytes) else v) for k, v in d.items()}
        d["trend_score"] = float(d.get("trend_score") or 0.0)
        return cls(**d)


class Job(BaseModel):
    """The `jobs:{job_id}` hash (§4)."""

    job_id: str
    episode_url: str
    stage: str = "queued"  # queued|submitted|rendering|publishing|done|failed
    status: str = "ok"  # ok | error
    retries: int = 0
    title: str = ""
    topic: str = ""
    engine_job_id: str = ""  # OpenShorts job id once submitted
    created_at: float = Field(default_factory=_now)
    updated_at: float = Field(default_factory=_now)
    error: str = ""

    def to_redis(self) -> dict[str, str]:
        return _flatten(self.model_dump())

    @classmethod
    def from_redis(cls, d: dict[str, Any]) -> "Job":
        d = {k: (v.decode() if isinstance(v, bytes) else v) for k, v in d.items()}
        d["retries"] = int(d.get("retries") or 0)
        for f in ("created_at", "updated_at"):
            d[f] = float(d.get(f) or _now())
        return cls(**d)


class JobEvent(BaseModel):
    """Entry written to the `jobs:stream` so the dashboard can tail status changes."""

    job_id: str
    stage: str
    status: str = "ok"
    title: str = ""
    message: str = ""
    ts: float = Field(default_factory=_now)

    def to_redis(self) -> dict[str, str]:
        return _flatten(self.model_dump())


class ClipResult(BaseModel):
    """The `results:{clip_id}` hash (§4)."""

    clip_id: str
    job_id: str
    clip_url: str = ""
    platform: str = "tiktok"  # tiktok|instagram|youtube
    post_id: str = ""
    posted_at: str = ""
    title: str = ""
    topic: str = ""
    hook: str = ""
    length_seconds: float = 0.0
    views: int = 0
    likes: int = 0
    shares: int = 0
    watch_time: float = 0.0  # avg seconds watched
    engagement_score: float = 0.0

    def to_redis(self) -> dict[str, str]:
        return _flatten(self.model_dump())

    @classmethod
    def from_redis(cls, d: dict[str, Any]) -> "ClipResult":
        d = {k: (v.decode() if isinstance(v, bytes) else v) for k, v in d.items()}
        for f in ("views", "likes", "shares"):
            d[f] = int(float(d.get(f) or 0))
        for f in ("length_seconds", "watch_time", "engagement_score"):
            d[f] = float(d.get(f) or 0.0)
        return cls(**d)


class Patterns(BaseModel):
    """The `patterns:current` JSON blob written by Lane B, read by Lane A (§4)."""

    winning_topics: list[str] = Field(default_factory=list)
    hook_templates: list[str] = Field(default_factory=list)
    ideal_length_min: float = 20.0
    ideal_length_max: float = 45.0
    caption_style: str = "bold-keyword-highlight"
    summary: str = ""
    updated_at: float = Field(default_factory=_now)

    def to_json(self) -> str:
        return self.model_dump_json()

    @classmethod
    def from_json(cls, raw: str | bytes | None) -> "Patterns":
        if not raw:
            return cls()
        if isinstance(raw, bytes):
            raw = raw.decode()
        return cls(**json.loads(raw))


class Variant(BaseModel):
    """One A/B variant config in `patterns:variants:{topic}` (§4)."""

    variant_id: str
    title: str
    caption: str
    hook: str
    thumbnail_prompt: str = ""


class VariantSet(BaseModel):
    topic: str
    variants: list[Variant] = Field(default_factory=list)
    updated_at: float = Field(default_factory=_now)

    def to_json(self) -> str:
        return self.model_dump_json()

    @classmethod
    def from_json(cls, raw: str | bytes | None) -> Optional["VariantSet"]:
        if not raw:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode()
        return cls(**json.loads(raw))


class EngineConfig(BaseModel):
    """`config` passed to OpenShorts `POST /process` (Lane A -> Lane C)."""

    num_clips: int = 3
    min_length: float = 20.0
    max_length: float = 45.0
    aspect_ratio: str = "9:16"
    caption_style: str = "bold-keyword-highlight"
    hook_templates: list[str] = Field(default_factory=list)
    scoring_provider: str = "openai"  # openai | gemini
    scoring_factors: list[str] = Field(
        default_factory=lambda: [
            "humor",
            "controversy",
            "insight",
            "emotional_intensity",
            "trend_relevance",
        ]
    )
    platforms: list[str] = Field(default_factory=lambda: ["tiktok", "instagram", "youtube"])
    topic_bias: list[str] = Field(default_factory=list)  # from patterns:current


class ProcessRequest(BaseModel):
    youtube_url: str
    config: EngineConfig = Field(default_factory=EngineConfig)
    title: str = ""
    topic: str = ""


class ProcessResponse(BaseModel):
    job_id: str


class EngineStatus(BaseModel):
    job_id: str
    stage: str  # queued|submitted|rendering|publishing|done|failed
    status: str = "ok"
    progress: float = 0.0
    clips: list[str] = Field(default_factory=list)  # clip_ids written to results:*
    error: str = ""


class CoordMessage(BaseModel):
    """Multiagent coordination message on `coord:log` (§6)."""

    lane: str  # A | B | C | D
    kind: str  # info | contract-change | error | milestone
    message: str
    ts: float = Field(default_factory=_now)

    def to_redis(self) -> dict[str, str]:
        return _flatten(self.model_dump())
