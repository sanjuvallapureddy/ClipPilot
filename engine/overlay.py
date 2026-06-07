"""Lane C — burn a TITLE headline across the top of a rendered short.

OpenShorts already produces the vertical 9:16 short (download, transcription, viral-moment
detection, face-tracking reframe, word-synced captions). It does NOT add a title headline.
This module adds exactly that one missing thing so the audience SEES the clip's title in
the video — it is a branding/headline overlay, NOT a reimplementation of OpenShorts'
caption burner (the golden rule still holds: all clipping/captioning stays in OpenShorts).

Why Pillow + ffmpeg ``overlay`` (and not ffmpeg ``drawtext``): many ffmpeg builds ship
without libfreetype, so ``drawtext``/``subtitles`` are unavailable. We instead render the
headline to a transparent PNG with Pillow (its wheel bundles freetype, so text always
renders) and composite it with ffmpeg's ``overlay`` filter, which needs no font libraries.

``burn_title`` returns the path to the new titled mp4 inside the served media dir, or
``None`` on any failure (caller keeps the original clip so the render still ships).
"""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path

import httpx

from shared.redis_client import coord

from .download import MEDIA_DIR

# Browser-facing base URL for engine-served media (the titled clip plays in the dashboard
# <video>). This is DISTINCT from ENGINE_PUBLIC_URL, which is a container->host address
# (e.g. host.docker.internal) used so OpenShorts can fetch source segments — a browser
# can't resolve that. Defaults to localhost:8001 (engine's mapped port in local dev /
# docker-compose). The upload route maps any "/media/<name>" URL back to the local file,
# so uploads work regardless of the host here.
ENGINE_MEDIA_PUBLIC_URL = os.getenv(
    "ENGINE_MEDIA_PUBLIC_URL", "http://localhost:8001"
).rstrip("/")
# Title overlay is on by default so every short ships with its title visible; the gate lets
# it be turned off without a code change (mirrors OPENSHORTS_BURN_CAPTIONS).
BURN_TITLE = os.getenv("ENGINE_BURN_TITLE", "true").lower() in ("1", "true", "yes", "on")
# Optional explicit font (bold .ttf/.ttc). Otherwise we search common system fonts and
# finally fall back to Pillow's bundled scalable font so text always renders.
TITLE_FONT_FILE = os.getenv("TITLE_FONT_FILE", "")
_FONT_CANDIDATES = [
    TITLE_FONT_FILE,
    # macOS
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    "/Library/Fonts/Arial Bold.ttf",
    # Linux (DejaVu/Liberation are common on slim images when fonts are installed)
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf",
]
_DOWNLOAD_TIMEOUT = int(os.getenv("ENGINE_CLIP_DOWNLOAD_TIMEOUT", "120"))
_FFMPEG_TIMEOUT = int(os.getenv("ENGINE_TITLE_FFMPEG_TIMEOUT", "300"))


def available() -> bool:
    """True when we can burn a title (Pillow importable + ffmpeg/ffprobe on PATH)."""
    if not BURN_TITLE:
        return False
    try:
        import PIL  # noqa: F401
    except Exception:
        return False
    return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


def public_url(path: str) -> str:
    """Engine-served URL for a file written into MEDIA_DIR (so the dashboard can play it)."""
    return f"{ENGINE_MEDIA_PUBLIC_URL}/media/{Path(path).name}"


def _load_font(size: int):
    from PIL import ImageFont

    for cand in _FONT_CANDIDATES:
        if cand and os.path.isfile(cand):
            try:
                return ImageFont.truetype(cand, size=size)
            except Exception:
                continue
    try:
        return ImageFont.load_default(size=size)  # Pillow>=10.1 returns a scalable font
    except Exception:
        return ImageFont.load_default()


def _wrap_lines(draw, text: str, font, max_width: float, max_lines: int) -> list[str]:
    """Greedy word-wrap to ``max_width`` px; cap at ``max_lines`` with an ellipsis."""
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        trial = f"{current} {word}".strip()
        if draw.textlength(trial, font=font) <= max_width or not current:
            current = trial
        else:
            lines.append(current)
            current = word
        if len(lines) >= max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)

    # If text overflowed the line budget, mark the last line with an ellipsis.
    used = sum(len(line.split()) for line in lines)
    if used < len(words) and lines:
        last = lines[-1]
        while last and draw.textlength(last + "…", font=font) > max_width:
            last = last.rsplit(" ", 1)[0] if " " in last else last[:-1]
        lines[-1] = (last + "…") if last else "…"
    return lines or [text[:1]]


def _render_title_png(text: str, width: int, height: int, out_png: str) -> bool:
    """Draw the title into a transparent ``width``x``height`` PNG: a translucent rounded
    bar near the top with centered bold white text (plus a soft shadow for legibility)."""
    try:
        from PIL import Image, ImageDraw
    except Exception as e:
        coord("C", "error", f"title overlay needs Pillow: {e}")
        return False

    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    side_margin = round(width * 0.045)
    font_size = max(22, round(width * 0.066))
    font = _load_font(font_size)
    inner_pad_x = round(width * 0.04)
    inner_pad_y = round(font_size * 0.55)
    max_text_width = width - 2 * side_margin - 2 * inner_pad_x

    lines = _wrap_lines(draw, text, font, max_text_width, max_lines=3)
    line_height = round(font_size * 1.2)
    text_block_h = line_height * len(lines)

    bar_top = round(height * 0.05)
    bar_left = side_margin
    bar_right = width - side_margin
    bar_bottom = bar_top + text_block_h + 2 * inner_pad_y
    radius = round(font_size * 0.45)

    draw.rounded_rectangle(
        [bar_left, bar_top, bar_right, bar_bottom],
        radius=radius,
        fill=(0, 0, 0, 165),
    )

    shadow = max(2, round(font_size * 0.045))
    y = bar_top + inner_pad_y
    for line in lines:
        line_w = draw.textlength(line, font=font)
        x = (width - line_w) / 2
        draw.text((x + shadow, y + shadow), line, font=font, fill=(0, 0, 0, 200))
        draw.text((x, y), line, font=font, fill=(255, 255, 255, 255))
        y += line_height

    try:
        img.save(out_png)
        return True
    except Exception as e:
        coord("C", "error", f"failed to write title PNG: {e}")
        return False


def _probe_dimensions(path: str) -> tuple[int, int]:
    """Return (width, height) of the first video stream via ffprobe, or (0, 0)."""
    try:
        out = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", path,
            ],
            capture_output=True, text=True, timeout=30, check=True,
        ).stdout.strip()
        w, h = out.split("x")[:2]
        return int(w), int(h)
    except Exception as e:
        coord("C", "error", f"ffprobe failed for {path}: {e}")
        return 0, 0


def _resolve_local_source(src: str, clip_id: str) -> tuple[str | None, bool]:
    """Return (local_path, is_temp). Downloads an http(s) clip URL into MEDIA_DIR."""
    if not src:
        return None, False
    if not src.lower().startswith(("http://", "https://")):
        return (src, False) if os.path.isfile(src) else (None, False)

    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    dest = MEDIA_DIR / f"_srcdl_{clip_id}.mp4"
    try:
        with httpx.Client(timeout=_DOWNLOAD_TIMEOUT, follow_redirects=True) as client:
            with client.stream("GET", src) as resp:
                resp.raise_for_status()
                with open(dest, "wb") as fh:
                    for chunk in resp.iter_bytes(chunk_size=1 << 16):
                        fh.write(chunk)
    except Exception as e:
        coord("C", "error", f"could not fetch clip for title overlay ({src}): {e}")
        return None, False
    if dest.exists() and dest.stat().st_size > 0:
        return str(dest), True
    return None, False


def burn_title(clip_src: str, title: str, clip_id: str) -> str | None:
    """Burn ``title`` across the top of the clip and return the titled mp4 path (in
    MEDIA_DIR, so the engine serves it at ``/media``). ``clip_src`` may be a local path or
    an http(s) URL (the OpenShorts-served clip). Returns ``None`` on any failure so the
    caller keeps the original clip — the render still ships, just without the headline.
    """
    if not available() or not title.strip():
        return None

    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    local_src, is_temp = _resolve_local_source(clip_src, clip_id)
    if not local_src:
        return None

    png_path = str(MEDIA_DIR / f".title_{clip_id}.png")
    out_path = str(MEDIA_DIR / f"titled_{clip_id}.mp4")
    try:
        width, height = _probe_dimensions(local_src)
        if width <= 0 or height <= 0:
            return None
        if not _render_title_png(title, width, height, png_path):
            return None

        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", local_src, "-i", png_path,
            "-filter_complex", "[0:v][1:v]overlay=0:0,format=yuv420p[v]",
            "-map", "[v]", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            out_path,
        ]
        subprocess.run(cmd, capture_output=True, check=True, timeout=_FFMPEG_TIMEOUT)
    except subprocess.CalledProcessError as e:
        stderr = (e.stderr or b"").decode("utf-8", "ignore")[-300:] if e.stderr else ""
        coord("C", "error", f"title overlay ffmpeg failed (clip {clip_id}): {stderr}")
        return None
    except Exception as e:
        coord("C", "error", f"title overlay failed (clip {clip_id}): {e}")
        return None
    finally:
        for tmp in ([png_path] + ([local_src] if is_temp else [])):
            try:
                os.remove(tmp)
            except OSError:
                pass

    if os.path.isfile(out_path) and os.path.getsize(out_path) > 0:
        coord("C", "info", f"burned title onto clip {clip_id}: “{title[:60]}”")
        return out_path
    return None
