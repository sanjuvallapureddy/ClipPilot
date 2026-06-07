"""Lane C — full source-video download (INGEST only).

Downloads the REAL source video with yt-dlp (which resolves YouTube's stream cipher) and
FFmpeg (merges bestvideo+bestaudio into an mp4). This is *ingest* so the rest of the
pipeline + OpenShorts have the real file to work from — clip cutting / reframing stays in
OpenShorts (the golden rule). Idempotent: an already-downloaded file is reused.

FFmpeg must be on PATH (yt-dlp invokes it for the merge). No synthetic media anywhere.
"""
from __future__ import annotations

import os
import subprocess
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


def download_section(youtube_url: str, start_seconds: float, end_seconds: float,
                     suffix: str = "segment") -> str | None:
    """Download a bounded real segment to media/{video_id}_{suffix}.mp4.

    This is source preparation only: OpenShorts still does the actual moment detection,
    clipping, reframing, captions, and rendering from the bounded source.
    """
    vid = video_id(youtube_url)
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    safe_suffix = "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in suffix)
    target = MEDIA_DIR / f"{vid}_{safe_suffix}.mp4"
    if target.exists() and target.stat().st_size > 0:
        coord("C", "info", f"source segment already present: {target}")
        return str(target)

    start = max(0, int(start_seconds))
    end = max(start + 1, int(end_seconds))
    section = f"*{start}-{end}"  # human-readable label for logging only

    try:
        import yt_dlp
        from yt_dlp.utils import download_range_func
    except Exception as e:
        coord("C", "error", f"yt-dlp unavailable for section download {vid} {section}: {e}")
        return None

    # Transfer ONLY the requested range — not the whole stream.
    #
    # The YoutubeDL *API* option is ``download_ranges`` (a callable built with
    # ``download_range_func``). ``download_sections`` is a CLI-only flag; passed to the
    # API it is silently ignored, so yt-dlp would fall back to fetching the ENTIRE video
    # stream and only trim afterwards (the bandwidth bug: a 2-min window pulled the full
    # ~500MB DASH stream). With a real range set AND ``force_keyframes_at_cuts`` disabled,
    # yt-dlp routes the download through its ffmpeg downloader, which seeks on the INPUT
    # (``-ss``/``-t`` before ``-i``); for seekable HTTP(S) sources ffmpeg issues range
    # requests and reads only the bytes for that window. Keyframe-accurate cuts are
    # unnecessary here — OpenShorts re-encodes during clipping (the golden rule).
    opts = {
        "quiet": True,
        "no_warnings": True,
        "format": DOWNLOAD_FORMAT,
        "merge_output_format": "mp4",
        "outtmpl": str(MEDIA_DIR / f"{vid}_{safe_suffix}.%(ext)s"),
        "noplaylist": True,
        "download_ranges": download_range_func([], [(float(start), float(end))]),
        "force_keyframes_at_cuts": False,
        "retries": 3,
    }
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([youtube_url])
    except Exception as e:
        coord("C", "error", f"section download failed for {vid} {section}: {e}")
        return None

    if target.exists() and target.stat().st_size > 0:
        mb = target.stat().st_size // (1024 * 1024)
        coord("C", "info", f"downloaded segment {vid} {section} -> {target} ({mb} MB)")
        return str(target)
    for p in sorted(MEDIA_DIR.glob(f"{vid}_{safe_suffix}.*")):
        if p.stat().st_size > 0:
            coord("C", "info", f"downloaded segment {vid} {section} -> {p}")
            return str(p)
    coord("C", "error", f"section download produced no file for {vid} {section}")
    return None


def concat_segments(paths: list[str], out_suffix: str = "concat") -> str | None:
    """Concatenate already-downloaded source segments into one mp4 (source prep only).

    Joining bounded segments into a single source file is NOT clipping — OpenShorts still
    does all detection/cutting/reframing/captions on the combined source (the golden rule).
    Uses ffmpeg's concat demuxer with ``-c copy`` (stream copy, no re-encode) since every
    segment was downloaded with the same format. Returns the merged path, or ``None``.
    """
    real = [p for p in paths if p and Path(p).exists() and Path(p).stat().st_size > 0]
    if not real:
        return None
    if len(real) == 1:
        return real[0]

    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    safe_suffix = "".join(
        ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in out_suffix
    )
    base = Path(real[0]).name.split("_")[0]
    target = MEDIA_DIR / f"{base}_{safe_suffix}.mp4"
    if target.exists() and target.stat().st_size > 0:
        coord("C", "info", f"merged source already present: {target}")
        return str(target)

    list_path = MEDIA_DIR / f".{base}_{safe_suffix}_concat.txt"
    try:
        with open(list_path, "w") as f:
            for p in real:
                # ffmpeg concat list: single-quote the path, escaping any embedded quotes.
                escaped = str(Path(p).resolve()).replace("'", "'\\''")
                f.write(f"file '{escaped}'\n")
        cmd = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0",
            "-i", str(list_path), "-c", "copy", str(target),
        ]
        subprocess.run(cmd, check=True, capture_output=True)
    except Exception as e:
        coord("C", "error", f"ffmpeg concat failed for {base}: {e}")
        return None
    finally:
        try:
            list_path.unlink()
        except OSError:
            pass

    if target.exists() and target.stat().st_size > 0:
        mb = target.stat().st_size // (1024 * 1024)
        coord("C", "info", f"merged {len(real)} segments -> {target} ({mb} MB)")
        return str(target)
    coord("C", "error", f"ffmpeg concat produced no file for {base}")
    return None
