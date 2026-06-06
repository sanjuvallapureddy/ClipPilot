"""Lane A — Autonomous orchestrator loop.

Reads the next item from `discovery:queue` (consumer group), dedupes via
`seen:{video_id}`, reads `patterns:current` to bias engine config, creates
`jobs:{job_id}`, calls the OpenShorts API (Lane C), polls status, advances stages +
`jobs:stream`, then repeats on a cadence. The closed loop: Lane B's patterns flow into
the EngineConfig we build here, so learning changes the next pick.
"""
from __future__ import annotations

import os
import time
import uuid
from urllib.parse import parse_qs, urlparse

import httpx

from shared import keys
from shared.redis_client import advance_job, coord, get_client, read_job, write_job
from shared.schemas import (
    DiscoveryItem,
    EngineConfig,
    Job,
    Patterns,
    ProcessRequest,
)

OPENSHORTS_URL = os.getenv("OPENSHORTS_URL", "http://localhost:8001")


def _video_id(url: str) -> str:
    try:
        q = parse_qs(urlparse(url).query)
        return q.get("v", [url])[0]
    except Exception:
        return url


def _ensure_group(r) -> None:
    try:
        r.xgroup_create(keys.DISCOVERY_QUEUE, keys.ORCHESTRATOR_GROUP, id="0",
                        mkstream=True)
    except Exception:
        pass  # BUSYGROUP -> already exists


def read_patterns(r) -> Patterns:
    return Patterns.from_json(r.get(keys.PATTERNS_CURRENT))


def build_config(patterns: Patterns) -> EngineConfig:
    """Translate learned patterns -> engine config. This is the learning feedback edge."""
    return EngineConfig(
        num_clips=int(os.getenv("CLIPS_PER_EPISODE", "3")),
        min_length=patterns.ideal_length_min,
        max_length=patterns.ideal_length_max,
        caption_style=patterns.caption_style,
        hook_templates=patterns.hook_templates,
        scoring_provider=os.getenv("ENGINE_SCORING_PROVIDER", "openai"),
        topic_bias=patterns.winning_topics,
    )


def next_item(r) -> tuple[str, DiscoveryItem] | None:
    """Pop one item from the consumer group. Returns (stream_id, item) or None."""
    _ensure_group(r)
    resp = r.xreadgroup(
        keys.ORCHESTRATOR_GROUP, keys.ORCHESTRATOR_CONSUMER,
        {keys.DISCOVERY_QUEUE: ">"}, count=1, block=1000,
    )
    if not resp:
        return None
    _, entries = resp[0]
    if not entries:
        return None
    stream_id, fields = entries[0]
    return stream_id, DiscoveryItem.from_redis(fields)


def process_item(item: DiscoveryItem, patterns: Patterns | None = None) -> str | None:
    """Create a job, call the engine, poll to completion. Returns job_id (or None if skipped)."""
    r = get_client()
    patterns = patterns or read_patterns(r)
    vid = _video_id(item.youtube_url)

    # dedupe
    if not r.set(keys.seen_key(vid), "1", nx=True, ex=keys.SEEN_TTL_SECONDS):
        coord("A", "info", f"skip duplicate {vid}")
        return None

    job_id = uuid.uuid4().hex[:8]
    job = Job(job_id=job_id, episode_url=item.youtube_url, title=item.title,
              topic=item.topic, stage="queued")
    write_job(job, r)
    advance_job(job, "queued", message=f"picked '{item.title}' (score={item.trend_score})", r=r)

    cfg = build_config(patterns)
    req = ProcessRequest(youtube_url=item.youtube_url, config=cfg, title=item.title,
                         topic=item.topic, clippilot_job_id=job_id)

    try:
        with httpx.Client(timeout=30) as client:
            resp = client.post(f"{OPENSHORTS_URL}/process", json=req.model_dump())
            resp.raise_for_status()
            engine_job_id = resp.json()["job_id"]
        job.engine_job_id = engine_job_id
        write_job(job, r)
        # engine drives the real stages (fetching -> transcribing -> analyzing -> done)
        coord("A", "info", f"submitted {job_id} to engine job {engine_job_id}")
    except Exception as e:
        advance_job(job, "failed", status="error", error=str(e),
                    message="engine submit failed", r=r)
        coord("A", "error", f"submit failed for {job_id}: {e}")
        return job_id

    # poll engine; the engine itself also advances our job stages (A & C write), so we
    # just wait for terminal state and reconcile.
    _poll_engine(job, engine_job_id)
    return job_id


def _poll_engine(job: Job, engine_job_id: str, max_polls: int = 120) -> None:
    r = get_client()
    with httpx.Client(timeout=15) as client:
        for _ in range(max_polls):
            cur = read_job(job.job_id, r)
            if cur and cur.stage in ("done", "failed"):
                return
            try:
                st = client.get(f"{OPENSHORTS_URL}/status/{engine_job_id}").json()
            except Exception:
                time.sleep(1)
                continue
            if st.get("stage") in ("done", "failed"):
                cur = read_job(job.job_id, r) or job
                if cur.stage not in ("done", "failed"):
                    advance_job(cur, st["stage"],
                                message=f"{len(st.get('clips', []))} clips",
                                status="ok" if st["stage"] == "done" else "error",
                                error=st.get("error", ""), r=r)
                return
            time.sleep(1)
    coord("A", "error", f"poll timeout for {job.job_id}")


def run_once(topic: str = "tech") -> dict:
    """One full cycle: ensure queue has work (discover if empty) -> process one item."""
    from . import discovery

    r = get_client()
    patterns = read_patterns(r)

    nxt = next_item(r)
    if not nxt:
        discovery.discover(topic=topic, patterns=patterns)
        nxt = next_item(r)
    if not nxt:
        return {"status": "empty", "message": "nothing to process"}

    stream_id, item = nxt
    job_id = process_item(item, patterns)
    r.xack(keys.DISCOVERY_QUEUE, keys.ORCHESTRATOR_GROUP, stream_id)
    final = read_job(job_id, r) if job_id else None
    return {
        "status": "ok",
        "job_id": job_id,
        "title": item.title,
        "trend_score": item.trend_score,
        "stage": final.stage if final else "skipped",
    }
