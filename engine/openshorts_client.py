"""Lane C -> OpenShorts render client.

Sends a video to the REAL OpenShorts backend (the clip generator) and returns the rendered
vertical clips. OpenShorts does all the heavy lifting (yt-dlp download -> faster-whisper ->
moment detection -> 9:16 face-tracking reframe -> burned captions); we only submit, poll,
trigger captioning, and collect the served clip URLs. We do NOT reimplement any of that
(the golden rule). The OpenShorts UI stays hidden — we use only its HTTP API + its static
/videos mount.

Verified contract (read from the container's app.py / subtitles.py):
  POST {API}/api/process
     header  X-Gemini-Key: <OpenAI key>   (OpenShorts' LLM layer is patched to OpenAI and
                                            uses this header value as the OpenAI key)
     json    {"url": "<youtube_url>", "acknowledged": true}
     -> {"job_id": "...", "status": "queued"}
     NOTE: the /api/process pipeline reframes to 9:16 but does NOT burn captions — that is
     a separate OpenShorts endpoint (below). So clips come out caption-less unless we ask.
  GET {API}/api/status/{job_id}
     -> {"status": queued|processing|completed|failed, "logs": [...], "result": {...}}
        result = {"clips": [{"video_url": "/videos/{job_id}/{file}", ...}], "cost_analysis": {}}
  POST {API}/api/subtitle   (OpenShorts' OWN word-synced caption burner: generate_srt +
                             burn_subtitles, ffmpeg `subtitles=` filter)
     json    {"job_id": "...", "clip_index": <i>, ...style}
     -> {"success": true, "new_video_url": "/videos/{job_id}/subtitled_{file}"}
     Burns the stored transcript for that clip's window into the mp4 and rewrites the
     clip's video_url to the subtitled file. We call this per clip after a job completes.
  Clips served (playable mp4) at {PUBLIC}/videos/{job_id}/{file}.
"""
from __future__ import annotations

import os
import time
from collections.abc import Callable
from pathlib import Path

import httpx

from shared.redis_client import coord
from . import download, most_replayed, transcript

OPENSHORTS_API_URL = os.getenv("OPENSHORTS_API_URL", "http://localhost:8010").rstrip("/")
# URL the BROWSER (dashboard) uses to fetch the rendered clips; same host in local dev.
OPENSHORTS_PUBLIC_URL = os.getenv("OPENSHORTS_PUBLIC_URL", OPENSHORTS_API_URL).rstrip("/")
DEFAULT_TIMEOUT_SECONDS = int(os.getenv("OPENSHORTS_TIMEOUT_SECONDS", "600"))
ENGINE_PUBLIC_URL = os.getenv("ENGINE_PUBLIC_URL", "http://localhost:8001").rstrip("/")
# Burned captions are an OpenShorts feature, but NOT part of its /api/process pipeline
# (that only reframes to 9:16). OpenShorts burns word-synced captions via its dedicated
# /api/subtitle endpoint, so after a job completes we trigger that per clip. Default ON so
# every short ships with captions; gate stays so it can be disabled without a code change.
BURN_CAPTIONS = os.getenv("OPENSHORTS_BURN_CAPTIONS", "true").lower() in (
    "1", "true", "yes", "on",
)
# Each /api/subtitle call blocks until OpenShorts re-encodes (ffmpeg burn) that one clip,
# so this timeout must comfortably cover a single 15–60s clip burn on CPU.
CAPTION_BURN_TIMEOUT_SECONDS = int(os.getenv("OPENSHORTS_CAPTION_TIMEOUT_SECONDS", "300"))
# We over-fetch a few near-equal replay peaks so the transcript can pick the punchiest
# ``max_segments`` of them. This is selection only — we still download at most
# ``max_segments`` windows (the budget is unchanged), so no extra network/disk.
_RANK_CANDIDATE_POOL = 6


class OpenShortsError(RuntimeError):
    """Raised when the real OpenShorts backend cannot produce clips."""


ProgressCallback = Callable[[str, str, float], None]


def _emit(on_progress: ProgressCallback | None, stage: str, message: str,
          progress: float) -> None:
    if on_progress:
        on_progress(stage, message, progress)


def _classify_processing_status(status: str, logs: list[object]) -> tuple[str, str, float]:
    """Map OpenShorts' coarse status/logs to ClipPilot's sequential stages."""
    tail = str(logs[-1]) if logs else ""
    recent = "\n".join(str(x) for x in logs[-12:]).lower()

    if status == "queued":
        return "fetching", "OpenShorts queued source video", 0.25
    if "initializing openai" in recent or "viral clips" in recent or "detect" in recent:
        return "analyzing", "OpenShorts detecting viral moments", 0.65
    if "transcrib" in recent or "->" in tail:
        return "transcribing", "OpenShorts transcribing source", 0.45
    if "download" in recent or "destination:" in recent:
        return "fetching", "OpenShorts downloading source video", 0.35
    return "fetching", "OpenShorts processing source video", 0.3


def _source_duration_seconds(youtube_url: str) -> float:
    """Fast metadata probe so long podcasts fail before entering OpenShorts."""
    try:
        import yt_dlp

        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": False,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(youtube_url, download=False)
        return float((info or {}).get("duration") or 0)
    except Exception as e:
        coord("C", "error", f"OpenShorts preflight duration probe failed: {e}")
        return 0.0


def _segment_url(path: str) -> str:
    return f"{ENGINE_PUBLIC_URL}/media/{Path(path).name}"


def _select_segment_window(
    youtube_url: str,
    *,
    title: str = "",
    topic: str = "",
    max_duration: int,
) -> tuple[float, float]:
    """Pick a <=max_duration high-signal source window from real captions.

    We do not perform clipping here. This only bounds long source media so OpenShorts can
    still do the real detection/cutting/reframing/captions on a tractable segment.
    """
    segments = transcript.fetch_segments(youtube_url)
    if not segments:
        return 0.0, float(max_duration)

    keywords = {
        w.strip(".,!?;:()[]{}\"'").lower()
        for w in f"{title} {topic}".split()
        if len(w.strip(".,!?;:()[]{}\"'")) >= 4
    }
    best_start = 0.0
    best_score = -1.0
    window = float(max_duration)

    # Candidate starts every ~5 minutes from actual caption timestamps.
    starts = [0.0]
    starts.extend(t for t, _ in segments if int(t) % 300 < 8)
    seen: set[int] = set()
    for start in starts:
        bucket = int(start // 60)
        if bucket in seen:
            continue
        seen.add(bucket)
        end = start + window
        in_window = [(t, txt) for t, txt in segments if start <= t < end]
        if not in_window:
            continue
        text = " ".join(txt for _, txt in in_window).lower()
        keyword_hits = sum(text.count(k) for k in keywords)
        density = len(text) / 1000.0
        # Prefer content-rich windows with topic/title overlap, but avoid long intros.
        intro_penalty = 1.0 if start < 60 and len(segments) > 100 else 0.0
        score = density + keyword_hits * 2.0 - intro_penalty
        if score > best_score:
            best_score = score
            best_start = start

    return max(0.0, best_start), max(float(max_duration), best_start + window)


def _prepare_most_replayed_source(
    youtube_url: str,
    *,
    on_progress: ProgressCallback | None = None,
) -> tuple[str | None, float]:
    """Separate setup: bound the source to a short window around the most-replayed peak.

    Returns ``(segment_url_or_None, duration_seconds)``. ``duration`` is surfaced so the
    caller can reuse it for the keyword fallback without a second metadata probe. A
    ``None`` segment means "no heatmap / download failed" — fall back to the old behavior.
    """
    if not most_replayed.enabled():
        return None, 0.0

    window_s = int(os.getenv(
        "MOST_REPLAYED_WINDOW_SECONDS",
        str(most_replayed.DEFAULT_WINDOW_SECONDS),
    ))
    similarity = float(os.getenv(
        "MOST_REPLAYED_PEAK_SIMILARITY",
        str(most_replayed.DEFAULT_PEAK_SIMILARITY),
    ))
    max_segments = int(os.getenv(
        "MOST_REPLAYED_MAX_SEGMENTS",
        str(most_replayed.DEFAULT_MAX_SEGMENTS),
    ))
    transcript_weight = float(os.getenv(
        "MOST_REPLAYED_TRANSCRIPT_WEIGHT",
        str(most_replayed.DEFAULT_TRANSCRIPT_WEIGHT),
    ))
    intro_skip = float(os.getenv(
        "MOST_REPLAYED_INTRO_SKIP_SECONDS",
        str(most_replayed.DEFAULT_INTRO_SKIP_SECONDS),
    ))
    _emit(on_progress, "fetching", "finding most-replayed peaks", 0.16)
    markers, duration = most_replayed.fetch_heatmap(youtube_url)

    # HEATMAP IS PRIMARY: only ever consider windows anchored on real replay peaks. We
    # over-fetch the near-equal peaks (within the similarity band) so the transcript can
    # pick the punchiest ``max_segments`` below; the download budget stays ``max_segments``.
    candidate_pool = max(max_segments, _RANK_CANDIDATE_POOL)
    candidates = most_replayed.peak_windows(
        markers,
        duration,
        window_seconds=window_s,
        similarity=similarity,
        max_segments=candidate_pool,
    )
    if not candidates:
        return None, duration

    # TRANSCRIPT IS SECONDARY: fetch the real captions ONCE, then rerank/guard the heatmap
    # candidates. A caption-less video falls back gracefully (heatmap-only) inside
    # ``rank_windows`` — we never nuke a video just because it has no captions.
    _emit(on_progress, "fetching", "ranking peaks by transcript punch", 0.18)
    segments = transcript.fetch_segments(youtube_url)
    if not segments:
        coord("C", "info", "most-replayed: no captions; ranking by heatmap only (graceful)")

    peaks = most_replayed.rank_windows(
        candidates,
        segments,
        intro_skip_seconds=intro_skip,
        transcript_weight=transcript_weight,
        max_segments=max_segments,
    )
    if not peaks:
        return None, duration

    # Surface the music-only intro guard when it fires (a first-2-min peak was skipped).
    if segments and any(
        c.start < intro_skip
        and most_replayed.is_music_only(most_replayed.segments_in_window(segments, c))
        for c in candidates
    ):
        _emit(on_progress, "fetching", "skipping music-only intro", 0.19)
        coord("C", "info", "most-replayed: skipped music-only intro window(s)")

    # ``rank_windows`` returns best-first; download/concat in chronological order so the
    # combined source keeps a clean timeline (OpenShorts re-detects moments either way).
    peaks = sorted(peaks, key=lambda w: w.start)

    n = len(peaks)
    win_min = round(window_s / 60, 1)
    if n == 1:
        _emit(
            on_progress,
            "fetching",
            f"most-replayed peak at {round(peaks[0].peak / 60, 1)}m — "
            f"grabbing {win_min}m window",
            0.2,
        )
    else:
        _emit(
            on_progress,
            "fetching",
            f"most-replayed: {n} peaks similar; grabbing {n}×{win_min}m windows",
            0.2,
        )

    paths: list[str] = []
    for peak in peaks:
        _emit(
            on_progress,
            "fetching",
            f"downloading source segment {round(peak.start / 60, 1)}–"
            f"{round(peak.end / 60, 1)}m",
            0.22,
        )
        suffix = f"peak_{int(peak.start)}_{int(peak.end)}"
        path = download.download_section(youtube_url, peak.start, peak.end, suffix=suffix)
        if not path:
            coord("C", "error", "most-replayed segment download failed; falling back")
            return None, duration
        paths.append(path)

    if len(paths) == 1:
        segment = _segment_url(paths[0])
    else:
        _emit(
            on_progress,
            "fetching",
            f"merging {len(paths)} most-replayed windows into one source",
            0.24,
        )
        merged = download.concat_segments(paths, out_suffix=f"peaks{len(paths)}")
        if not merged:
            coord("C", "error", "most-replayed concat failed; using first window only")
            merged = paths[0]
        segment = _segment_url(merged)

    coord(
        "C",
        "info",
        f"most-replayed source {youtube_url} -> {segment} ({len(paths)} window(s))",
    )
    return segment, duration


def _prepare_bounded_source(
    youtube_url: str,
    *,
    title: str = "",
    topic: str = "",
    window_seconds: int,
    on_progress: ProgressCallback | None = None,
) -> str:
    # Preferred path: clip around YouTube's most-replayed peak(s) (the moments viewers rewatch).
    segment, duration = _prepare_most_replayed_source(
        youtube_url, on_progress=on_progress
    )
    if segment:
        return segment

    # Fallback: no heatmap available. Never download a giant chunk — pick the single best
    # ~window_seconds window from real captions and grab only that. (The old 30-minute
    # source download has been eliminated; every window we download is bounded to window_seconds.)
    if not duration:
        duration = _source_duration_seconds(youtube_url)
    if not duration or duration <= window_seconds * 1.1:
        return youtube_url

    minutes = round(duration / 60, 1)
    win_min = round(window_seconds / 60, 1)
    _emit(
        on_progress,
        "fetching",
        f"no heatmap; selecting best {win_min}m window from {minutes}m source",
        0.18,
    )
    start, end = _select_segment_window(
        youtube_url, title=title, topic=topic, max_duration=window_seconds
    )
    suffix = f"segment_{int(start)}_{int(end)}"
    _emit(
        on_progress,
        "fetching",
        f"downloading source segment {round(start / 60, 1)}–{round(end / 60, 1)}m",
        0.22,
    )
    path = download.download_section(youtube_url, start, end, suffix=suffix)
    if not path:
        raise OpenShortsError(
            f"could not prepare {win_min} minute source window from {minutes} minute video"
        )
    segment = _segment_url(path)
    coord("C", "info", f"bounded source (no heatmap) {youtube_url} -> {segment}")
    return segment


def available() -> bool:
    """True when we can render via OpenShorts (its LLM step needs the OpenAI key)."""
    return bool(os.getenv("OPENAI_API_KEY"))


def _abs_clip_url(video_url: str) -> str:
    if not video_url:
        return ""
    return video_url if video_url.startswith("http") else f"{OPENSHORTS_PUBLIC_URL}{video_url}"


def _f(*vals: object) -> float:
    for v in vals:
        if v in (None, ""):
            continue
        try:
            return float(v)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            continue
    return 0.0


def _burn_captions(job_id: str, clips: list[dict], api_key: str, *,
                   on_progress: ProgressCallback | None = None) -> int:
    """Trigger OpenShorts' own caption burner on each rendered clip.

    OpenShorts already produced the vertical clips and stored the real word-level transcript
    in the job metadata. Its ``/api/subtitle`` endpoint regenerates an SRT for each clip's
    window and ffmpeg-burns it (``subtitles.py`` -> ``burn_subtitles``), then rewrites that
    clip's ``video_url`` to the ``subtitled_*`` file. We only call the endpoint — none of the
    captioning is reimplemented here (golden rule). We send no style overrides, so OpenShorts
    applies its proven default (white Verdana, black outline, bottom-aligned).

    Mutates each clip's ``video_url`` in place on success. Per-clip failures are non-fatal:
    a clip that can't be captioned (e.g. a music-only window with no transcript words) simply
    keeps its un-captioned URL so the render still ships. Returns the number captioned.
    """
    headers = {"X-Gemini-Key": api_key}
    total = len(clips)
    burned = 0
    with httpx.Client(timeout=CAPTION_BURN_TIMEOUT_SECONDS) as client:
        for idx, clip in enumerate(clips):
            if not clip.get("video_url"):
                continue
            _emit(on_progress, "analyzing",
                  f"OpenShorts burning captions into clip {idx + 1}/{total}", 0.9)
            try:
                resp = client.post(
                    f"{OPENSHORTS_API_URL}/api/subtitle",
                    headers=headers,
                    json={"job_id": job_id, "clip_index": idx},
                )
                resp.raise_for_status()
                new_url = (resp.json() or {}).get("new_video_url")
            except Exception as e:
                coord("C", "error",
                      f"OpenShorts caption burn failed (job {job_id} clip {idx}): {e}")
                continue
            if new_url:
                clip["video_url"] = new_url
                burned += 1
    if burned:
        coord("C", "milestone",
              f"OpenShorts burned captions into {burned}/{total} clips for job {job_id}")
    else:
        coord("C", "error",
              f"OpenShorts captioning produced no subtitled clips for job {job_id}")
    return burned


def generate_clips(youtube_url: str, *, title: str = "", topic: str = "",
                   timeout_s: int | None = None, poll_s: float = 5.0,
                   on_progress: ProgressCallback | None = None,
                   on_submit: Callable[[str], None] | None = None) -> list[dict]:
    """Submit a video to OpenShorts and return rendered clips.

    Each returned dict: {clip_url, filename, start, end, hook, quote, title, score}.

    ``on_submit`` (if given) is called with the OpenShorts ``job_id`` the moment OpenShorts
    accepts the source — BEFORE the long render poll. The engine uses this to persist the
    OpenShorts job id so a process restart mid-render can re-attach to the in-flight job via
    :func:`collect_clips` instead of stranding it (which previously caused a false timeout).
    """
    timeout_s = timeout_s or DEFAULT_TIMEOUT_SECONDS
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        coord("C", "info", "OpenShorts: no OPENAI_API_KEY; skipping render")
        raise OpenShortsError("OPENAI_API_KEY is required for OpenShorts")

    _emit(on_progress, "fetching", "checking source video", 0.15)
    window_seconds = int(os.getenv(
        "MOST_REPLAYED_WINDOW_SECONDS",
        str(most_replayed.DEFAULT_WINDOW_SECONDS),
    ))
    source_url = _prepare_bounded_source(
        youtube_url,
        title=title,
        topic=topic,
        window_seconds=window_seconds,
        on_progress=on_progress,
    )

    _emit(on_progress, "fetching", "submitting source video to OpenShorts", 0.2)
    headers = {"X-Gemini-Key": api_key}
    try:
        with httpx.Client(timeout=60) as client:
            resp = client.post(
                f"{OPENSHORTS_API_URL}/api/process",
                headers=headers,
                json={"url": source_url, "acknowledged": True},
            )
            if resp.status_code == 403:
                coord("C", "error", "OpenShorts: URL ingest disabled (403); skipping")
                raise OpenShortsError("OpenShorts rejected URL ingest (403)")
            resp.raise_for_status()
            job_id = resp.json().get("job_id")
    except Exception as e:
        coord("C", "error", f"OpenShorts submit failed: {e}")
        raise OpenShortsError(f"OpenShorts submit failed: {e}") from e
    if not job_id:
        coord("C", "error", "OpenShorts: no job_id returned")
        raise OpenShortsError("OpenShorts did not return a job_id")
    coord("C", "info", f"OpenShorts job {job_id} submitted; rendering {source_url}")
    _emit(on_progress, "fetching", f"OpenShorts job {job_id} accepted", 0.25)
    # Persist the OpenShorts job id NOW (before the long poll) so a restart can resume it.
    if on_submit:
        try:
            on_submit(job_id)
        except Exception as e:  # persistence is best-effort; never block the render on it
            coord("C", "error", f"on_submit hook failed for OpenShorts job {job_id}: {e}")

    # Poll the freshly-submitted job to completion, burn captions, and collect the clips.
    # collect_clips contains the entire post-submit path so the restart-resume code reuses
    # the EXACT same collection + caption-burning logic (no divergence).
    return collect_clips(
        job_id, title=title, topic=topic, timeout_s=timeout_s, poll_s=poll_s,
        on_progress=on_progress,
    )


def collect_clips(job_id: str, *, title: str = "", topic: str = "",
                  timeout_s: int | None = None, poll_s: float = 5.0,
                  on_progress: ProgressCallback | None = None) -> list[dict]:
    """Poll an ALREADY-SUBMITTED OpenShorts job to completion and return its clips.

    Shared by :func:`generate_clips` (fresh submit) and the engine restart-resume path. It
    polls ``/api/status/{job_id}`` until completed/failed/timeout, burns word-synced captions
    via ``/api/subtitle`` (when ``OPENSHORTS_BURN_CAPTIONS`` is on), and returns the rendered
    clip dicts. Because OpenShorts keeps a completed job queryable, this works whether the
    job is still rendering or already finished by the time we (re-)attach.

    Each returned dict: {clip_url, filename, start, end, hook, quote, title, score}.
    """
    timeout_s = timeout_s or DEFAULT_TIMEOUT_SECONDS
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        coord("C", "info", "OpenShorts: no OPENAI_API_KEY; cannot collect clips")
        raise OpenShortsError("OPENAI_API_KEY is required for OpenShorts")

    result = None
    deadline = time.time() + timeout_s
    with httpx.Client(timeout=30) as client:
        while time.time() < deadline:
            try:
                st = client.get(f"{OPENSHORTS_API_URL}/api/status/{job_id}").json()
            except Exception:
                time.sleep(poll_s)
                continue
            status = st.get("status")
            if status == "completed":
                result = st.get("result") or {}
                break
            if status == "failed":
                logs = st.get("logs") or []
                tail = logs[-1] if logs else ""
                coord("C", "error", f"OpenShorts job {job_id} failed: {tail}")
                raise OpenShortsError(f"OpenShorts job failed: {tail or 'unknown error'}")
            logs = st.get("logs") or []
            stage, message, progress = _classify_processing_status(status, logs)
            _emit(on_progress, stage, message, progress)
            time.sleep(poll_s)

    if result is None:
        coord("C", "error", f"OpenShorts job {job_id} timed out after {timeout_s}s")
        raise OpenShortsError(f"OpenShorts timed out after {timeout_s}s")

    # Burned captions: /api/process reframes but does NOT caption, so ask OpenShorts to burn
    # word-synced subtitles into each clip via its /api/subtitle endpoint. This rewrites each
    # captioned clip's video_url to the subtitled_* file (picked up when we build ``out``).
    clips = result.get("clips") or []
    if BURN_CAPTIONS and clips:
        _emit(on_progress, "analyzing", "OpenShorts burning captions into clips", 0.88)
        _burn_captions(job_id, clips, api_key, on_progress=on_progress)

    out: list[dict] = []
    for c in clips:
        video_url = c.get("video_url") or ""
        if not video_url:
            continue
        out.append({
            "clip_url": _abs_clip_url(video_url),
            "filename": video_url.split("/")[-1],
            "start": _f(c.get("start"), c.get("start_time"), c.get("start_seconds")),
            "end": _f(c.get("end"), c.get("end_time"), c.get("end_seconds")),
            "hook": c.get("hook") or c.get("title") or c.get("caption") or "",
            "quote": c.get("quote") or c.get("transcript") or c.get("text") or "",
            "title": c.get("title") or title,
            "score": _f(c.get("score"), c.get("virality_score"), c.get("rating")),
        })
    coord("C", "milestone", f"OpenShorts job {job_id} rendered {len(out)} vertical clips")
    if not out:
        raise OpenShortsError("OpenShorts completed but returned no playable clips")
    return out
