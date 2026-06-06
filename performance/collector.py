"""Lane B — metric collection.

For each posted clip (results:{clip_id}), fetch real performance from Upload-Post /
platform APIs and update the hash. `--simulate` seeds realistic metrics so analytics and
learning work before platform numbers land (results often lag hours).
"""
from __future__ import annotations

import math
import os
import random
import time

from shared import keys
from shared.redis_client import coord, get_client
from shared.schemas import ClipResult


def _engagement(views: int, likes: int, shares: int, watch: float, length: float) -> float:
    if views <= 0:
        return 0.0
    rate = (likes + 3 * shares) / views
    completion = (watch / length) if length else 0.0
    return round(rate + 0.3 * completion, 4)


def simulate_metrics(clip: ClipResult) -> ClipResult:
    """Seed realistic, score-correlated metrics. Higher seed engagement_score -> more reach."""
    base = clip.engagement_score or random.uniform(0.3, 0.7)
    virality = max(0.1, min(1.5, random.gauss(base * 1.3, 0.25)))
    views = int(math.exp(random.uniform(6.5, 11.5)) * virality)  # ~600 .. 250k
    likes = int(views * random.uniform(0.03, 0.16) * base)
    shares = int(views * random.uniform(0.002, 0.04) * base)
    length = clip.length_seconds or random.uniform(20, 45)
    watch = round(length * random.uniform(0.4, 0.95), 1)
    clip.views, clip.likes, clip.shares = views, likes, shares
    clip.length_seconds, clip.watch_time = length, watch
    clip.engagement_score = _engagement(views, likes, shares, watch, length)
    return clip


def fetch_upload_post_metrics(clip: ClipResult) -> ClipResult:  # pragma: no cover
    """Poll Upload-Post / platform APIs for one clip. Returns clip updated in place."""
    api_key = os.getenv("UPLOAD_POST_API_KEY")
    if not api_key or not clip.post_id:
        return clip
    try:
        import httpx

        # NOTE: verify Upload-Post analytics endpoint shape against their docs.
        with httpx.Client(timeout=15) as c:
            r = c.get(
                f"https://api.upload-post.com/v1/posts/{clip.post_id}/analytics",
                headers={"Authorization": f"Bearer {api_key}"},
            )
            r.raise_for_status()
            d = r.json()
        clip.views = int(d.get("views", clip.views))
        clip.likes = int(d.get("likes", clip.likes))
        clip.shares = int(d.get("shares", clip.shares))
        clip.watch_time = float(d.get("avg_watch_seconds", clip.watch_time))
        clip.engagement_score = _engagement(
            clip.views, clip.likes, clip.shares, clip.watch_time, clip.length_seconds
        )
    except Exception as e:
        coord("B", "error", f"upload-post fetch failed for {clip.clip_id}: {e}")
    return clip


def collect(simulate: bool | None = None) -> int:
    """Update every results:{clip_id} with fresh metrics. Returns count updated."""
    simulate = os.getenv("PERFORMANCE_SIMULATE", "1") == "1" if simulate is None else simulate
    r = get_client()
    n = 0
    for clip_id in list(r.smembers(keys.RESULTS_SET)):
        d = r.hgetall(keys.result_key(clip_id))
        if not d:
            continue
        clip = ClipResult.from_redis(d)
        clip = simulate_metrics(clip) if simulate else fetch_upload_post_metrics(clip)
        if not clip.posted_at:
            clip.posted_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        r.hset(keys.result_key(clip_id), mapping=clip.to_redis())
        n += 1
    coord("B", "milestone", f"collected metrics for {n} clips (simulate={simulate})")
    return n
