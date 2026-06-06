"""Lane C — full source-video download (INGEST only).

Downloads the REAL source video with yt-dlp (which resolves YouTube's stream cipher) and
FFmpeg (merges bestvideo+bestaudio into an mp4). This is *ingest* so the rest of the
pipeline + OpenShorts have the real file to work from — clip cutting / reframing stays in
OpenShorts (the golden rule). Idempotent: an already-downloaded file is reused.

FFmpeg must be on PATH (yt-dlp invokes it for the merge). No synthetic media anywhere.
"""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from shared.redis_client import coord

MEDIA_DIR = Path(os.getenv("MEDIA_DIR", "media"))
# Cap resolution so a 4K multi-hour episode doesn't fill the disk, but never SKIP the
# download (no max_filesize) — the requirement is that the real file lands locally.
DOWNLOAD_FORMAT = os.getenv(
    "DOWNLOAD_FORMAT", "bv*[height<=1080]+ba/b[height<=1080]/b"
)


def video_id(url: str) -> str:
    """Best-effort YouTube video id from a watch / youtu.be / shorts URL."""
    try:
        u = urlparse(url)
        if u.query:
            q = parse_qs(u.query)
            if q.get("v"):
                return q["v"][0]
        parts = [p for p in u.path.split("/") if p]
        if parts:
            return parts[-1]
    except Exception:
        pass
    return url


def download(youtube_url: str) -> str | None:
    """Download the full source video to media/{video_id}.mp4. Returns path or None.

    yt-dlp resolves the stream and invokes FFmpeg to merge into mp4. Idempotent.
    """
    vid = video_id(youtube_url)
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    target = MEDIA_DIR / f"{vid}.mp4"
    if target.exists() and target.stat().st_size > 0:
        coord("C", "info", f"source video already present: {target}")
        return str(target)

    opts = {
        "quiet": True,
        "no_warnings": True,
        "format": DOWNLOAD_FORMAT,
        "merge_output_format": "mp4",
        "outtmpl": str(MEDIA_DIR / f"{vid}.%(ext)s"),
        "noplaylist": True,
        "retries": 3,
    }
    try:
        import yt_dlp

        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([youtube_url])
    except Exception as e:  # real failure -> None, never faked
        coord("C", "error", f"download failed for {vid}: {e}")
        return None

    if target.exists() and target.stat().st_size > 0:
        mb = target.stat().st_size // (1024 * 1024)
        coord("C", "info", f"downloaded {vid} -> {target} ({mb} MB)")
        return str(target)
    # merge may have produced a non-mp4 container; accept whatever real file landed
    for p in sorted(MEDIA_DIR.glob(f"{vid}.*")):
        if p.stat().st_size > 0:
            coord("C", "info", f"downloaded {vid} -> {p}")
            return str(p)
    coord("C", "error", f"download produced no file for {vid}")
    return None
