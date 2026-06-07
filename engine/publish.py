"""Lane C — honest social posting hook (Upload-Post).

REAL DATA ONLY. Posting a clip is only meaningful once two real prerequisites exist:

  1. ``UPLOAD_POST_API_KEY`` is configured (real platform credentials), and
  2. OpenShorts has actually rendered a vertical 9:16 short for the clip, i.e.
     ``clip.render_status == "rendered"`` AND the rendered file exists on disk.

Until the OpenShorts render handoff is wired, every clip carries
``render_status="pending"`` (see ``engine/pipeline.py`` / ``shared/schemas.ClipResult``),
so ``publish_clip`` is a guarded NO-OP: it returns the clip unchanged and never invents a
``post_id`` / ``posted_at`` / flips ``post_status``. That is intentional and honest — a
post is recorded ONLY when a real upload actually happened.

When the render path lands (OpenShorts writes ``clip_url`` + ``render_status="rendered"``
and a real file), this hook uploads the rendered short via Upload-Post and records the
real ``platform`` / ``post_id`` / ``posted_at`` so Lane B's ``collector`` can then poll
real metrics for it.

NOTE: the exact Upload-Post upload endpoint / field names should be verified against
their current API docs before going live (same caveat as ``performance/collector.py``).
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

from shared import keys
from shared.redis_client import coord
from shared.schemas import ClipResult


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def publish_clip(clip: ClipResult, clip_file_path: str | None) -> ClipResult:
    """Post a REAL rendered short to social platforms via Upload-Post.

    Guarded no-op unless ALL of the following hold (never fakes a post):
      * ``UPLOAD_POST_API_KEY`` is set,
      * ``clip.render_status == "rendered"``, and
      * ``clip_file_path`` points at a real file on disk.

    On a successful upload it sets ``clip.platform`` / ``clip.post_id`` /
    ``clip.posted_at`` and flips ``clip.post_status = "posted"``. Returns the (possibly
    updated) clip.
    """
    api_key = os.getenv("UPLOAD_POST_API_KEY")

    # Guard 1: no credentials -> honest no-op.
    if not api_key:
        return clip
    # Guard 2: nothing real to post until OpenShorts renders the vertical short.
    if clip.render_status != "rendered":
        return clip
    # Guard 3: the rendered short must actually exist on disk.
    if not clip_file_path or not os.path.isfile(clip_file_path):
        coord("C", "info",
              f"publish skipped for {clip.clip_id}: render_status=rendered but no file on disk")
        return clip

    platforms = [
        p.strip()
        for p in os.getenv("UPLOAD_POST_PLATFORMS", ",".join(keys.PLATFORMS)).split(",")
        if p.strip()
    ]

    try:
        import httpx

        with open(clip_file_path, "rb") as fh:
            with httpx.Client(timeout=120) as c:
                resp = c.post(
                    "https://api.upload-post.com/v1/posts",
                    headers={"Authorization": f"Bearer {api_key}"},
                    data={
                        "title": clip.title or clip.hook,
                        "caption": clip.hook,
                        "platforms": ",".join(platforms),
                    },
                    files={"video": (os.path.basename(clip_file_path), fh, "video/mp4")},
                )
                resp.raise_for_status()
                d = resp.json()
    except Exception as e:  # real failure -> leave the clip unposted, never faked
        coord("C", "error", f"upload-post publish failed for {clip.clip_id}: {e}")
        return clip

    clip.post_id = str(d.get("id") or d.get("post_id") or "")
    clip.platform = ",".join(platforms)
    clip.posted_at = _now_iso()
    clip.post_status = "posted"
    coord("C", "milestone",
          f"published {clip.clip_id} -> {clip.platform} (post_id={clip.post_id or 'n/a'})")
    return clip
