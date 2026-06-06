"""Real transcript extraction for Lane C.

Pulls the REAL timestamped transcript of a YouTube episode via yt-dlp captions (no API
key, fast, free). Falls back to OpenAI Whisper on the downloaded audio when an episode
has no captions. Then merges caption lines into ~clip-length candidate windows for GPT
moment scoring. No synthetic text anywhere.
"""
from __future__ import annotations

import json
import os
import tempfile
import urllib.request


def fetch_segments(url: str) -> list[tuple[float, str]]:
    """Return real [(start_seconds, text), ...] for the episode. Empty if unavailable."""
    segs = _from_captions(url)
    if segs:
        return segs
    return _from_whisper(url)


def _from_captions(url: str) -> list[tuple[float, str]]:
    opts = {
        "quiet": True, "no_warnings": True, "skip_download": True,
        "writeautomaticsub": True, "writesubtitles": True, "subtitleslangs": ["en", "en-orig"],
    }
    try:
        import yt_dlp

        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception:
        return []

    caps = {}
    for src in (info.get("subtitles") or {}, info.get("automatic_captions") or {}):
        for lang in ("en", "en-orig"):
            if lang in src:
                caps = src[lang]
                break
        if caps:
            break
    if not caps:
        return []

    j3 = [c for c in caps if c.get("ext") == "json3"]
    if not j3:
        return []
    try:
        raw = urllib.request.urlopen(j3[0]["url"], timeout=30).read()
        data = json.loads(raw)
    except Exception:
        return []

    out: list[tuple[float, str]] = []
    for ev in data.get("events", []):
        if "segs" not in ev:
            continue
        t = ev.get("tStartMs", 0) / 1000.0
        txt = "".join(s.get("utf8", "") for s in ev["segs"]).strip()
        if txt:
            out.append((round(t, 1), txt))
    return out


def _from_whisper(url: str) -> list[tuple[float, str]]:  # pragma: no cover - needs audio+key
    """Download audio (yt-dlp) and transcribe with OpenAI Whisper. Real, but slower."""
    if not os.getenv("OPENAI_API_KEY"):
        return []
    try:
        import yt_dlp
        from openai import OpenAI

        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "audio.m4a")
            opts = {"quiet": True, "no_warnings": True, "format": "bestaudio/best",
                    "outtmpl": path, "max_filesize": 25 * 1024 * 1024}
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
            if not os.path.exists(path):
                return []
            client = OpenAI()
            with open(path, "rb") as f:
                tr = client.audio.transcriptions.create(
                    model="whisper-1", file=f, response_format="verbose_json",
                )
        return [(round(s.start, 1), s.text.strip()) for s in getattr(tr, "segments", [])]
    except Exception:
        return []


def make_windows(segments: list[tuple[float, str]], target_len: float = 40.0,
                 max_windows: int = 140) -> list[dict]:
    """Merge caption lines into ~target_len second candidate windows for scoring."""
    windows: list[dict] = []
    cur_start = None
    cur_text: list[str] = []
    for t, txt in segments:
        if cur_start is None:
            cur_start = t
        cur_text.append(txt)
        if t - cur_start >= target_len:
            windows.append({"start": cur_start, "end": t, "text": " ".join(cur_text)})
            cur_start, cur_text = None, []
    if cur_text and cur_start is not None:
        last = segments[-1][0] if segments else cur_start
        windows.append({"start": cur_start, "end": last, "text": " ".join(cur_text)})

    # if the episode is very long, sample evenly so the GPT call stays bounded (real data,
    # just fewer candidate windows considered)
    if len(windows) > max_windows:
        step = len(windows) / max_windows
        windows = [windows[int(i * step)] for i in range(max_windows)]
    for i, w in enumerate(windows):
        w["i"] = i
    return windows
