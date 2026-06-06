"""Lane B — metric collection (REAL only).

Polls Upload-Post / platform APIs for clips that have actually been posted
(post_status == "posted") and updates their `results:{clip_id}` hash with real views /
likes / shares / watch time. There is NO simulation: until clips are rendered (OpenShorts)
and posted (platform credentials), there are no real metrics, so collection is a no-op and
the numbers stay zero — honest, never invented.
"""
from __future__ import annotations

import os

from shared import keys
from shared.redis_client import coord, get_client
from shared.schemas import ClipResult


def _engagement(views: int, likes: int, shares: int, watch: float, length: float) -> float:
    if views <= 0:
        return 0.0
    return round((likes + 3 * shares) / views + 0.3 * ((watch / length) if length else 0), 4)


def fetch_upload_post_metrics(clip: ClipResult) -> ClipResult:  # pragma: no cover
    """Poll Upload-Post analytics for one posted clip. Verify endpoint vs. their docs."""
    api_key = os.getenv("UPLOAD_POST_API_KEY")
    if not api_key or not clip.post_id:
        return clip
    try:
        import httpx

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


def collect() -> int:
    """Update metrics for clips that are actually posted. Returns count updated."""
    if not os.getenv("UPLOAD_POST_API_KEY"):
        coord("B", "info", "no UPLOAD_POST_API_KEY — no real metrics to collect yet")
        return 0
    r = get_client()
    n = 0
    for clip_id in list(r.smembers(keys.RESULTS_SET)):
        d = r.hgetall(keys.result_key(clip_id))
        if not d:
            continue
        clip = ClipResult.from_redis(d)
        if clip.post_status != "posted":
            continue
        clip = fetch_upload_post_metrics(clip)
        r.hset(keys.result_key(clip_id), mapping=clip.to_redis())
        n += 1
    coord("B", "milestone", f"collected REAL metrics for {n} posted clips")
    return n
