"""Engine pipeline (Lane C) — REAL viral-moment detection.

For a real episode URL: fetch the real transcript (yt-dlp captions, Whisper fallback) ->
build candidate windows -> GPT scores them on podcast virality factors and returns the
top real moments (real quote, real timestamps, real hook, real reason, real score). Each
moment is written as a `results:{clip_id}` hash with render_status="pending" and
post_status="not_posted" — the actual vertical render needs OpenShorts and posting needs
platform credentials, so those fields are honest, never faked.

There is NO mock mode and NO synthetic clip data. Without an OPENAI_API_KEY the job fails
with a clear message rather than inventing moments.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid

from shared import keys
from shared.redis_client import advance_job, coord, get_client, read_job
from shared.schemas import ClipResult, EngineStatus, ProcessRequest

from . import download, observability, publish, transcript
from .scoring import FACTORS

_ENGINE_JOBS: dict[str, EngineStatus] = {}
ENGINE_JOB_PREFIX = "engine:job:"


def _persist(status: EngineStatus) -> None:
    _ENGINE_JOBS[status.job_id] = status
    try:
        get_client().hset(ENGINE_JOB_PREFIX + status.job_id, mapping={
            "stage": status.stage, "status": status.status,
            "progress": str(status.progress), "error": status.error,
            "clips": ",".join(status.clips),
        })
    except Exception:
        pass


def get_status(engine_job_id: str) -> EngineStatus | None:
    if engine_job_id in _ENGINE_JOBS:
        return _ENGINE_JOBS[engine_job_id]
    try:
        d = get_client().hgetall(ENGINE_JOB_PREFIX + engine_job_id)
        if d:
            return EngineStatus(
                job_id=engine_job_id, stage=d.get("stage", "queued"),
                status=d.get("status", "ok"), progress=float(d.get("progress", 0) or 0),
                clips=[c for c in d.get("clips", "").split(",") if c],
                error=d.get("error", ""),
            )
    except Exception:
        pass
    return None


def submit(req: ProcessRequest) -> str:
    engine_job_id = "eng-" + uuid.uuid4().hex[:8]
    _persist(EngineStatus(job_id=engine_job_id, stage="queued", progress=0.0))
    coord("C", "info", f"engine accepted {engine_job_id} for {req.youtube_url}")
    asyncio.create_task(_run(engine_job_id, req))
    return engine_job_id


def _advance_caller(req: ProcessRequest, stage: str, status: str = "ok",
                    error: str = "", message: str = "") -> None:
    if not req.clippilot_job_id:
        return
    job = read_job(req.clippilot_job_id)
    if job:
        advance_job(job, stage, message=message or f"engine: {stage}", status=status, error=error)


def _set(engine_job_id: str, req: ProcessRequest, stage: str, progress: float,
         status: str = "ok", error: str = "", message: str = "") -> None:
    st = get_status(engine_job_id)
    st.stage, st.progress, st.status, st.error = stage, progress, status, error
    _persist(st)
    _advance_caller(req, stage, status=status, error=error, message=message)


async def _run(engine_job_id: str, req: ProcessRequest) -> None:
    try:
        await _run_real(engine_job_id, req)
    except Exception as e:  # pragma: no cover
        _set(engine_job_id, req, "failed", 1.0, status="error", error=str(e),
             message=f"engine error: {e}")
        coord("C", "error", f"{engine_job_id} failed: {e}")


@observability.op("engine.process")
async def _run_real(engine_job_id: str, req: ProcessRequest) -> None:
    cfg = req.config

    # 1. fetch: download the REAL source video (ingest for OpenShorts + local Whisper),
    # then pull the real transcript. Download failure is non-fatal to moment detection
    # (captions may still exist) but is logged loudly.
    _set(engine_job_id, req, "fetching", 0.1, message="downloading source video")
    video_path = await asyncio.to_thread(download.download, req.youtube_url)
    if not video_path:
        coord("C", "info", "no local video; continuing with captions if available")

    _set(engine_job_id, req, "fetching", 0.2, message="fetching transcript")
    segments = await asyncio.to_thread(
        transcript.fetch_segments, req.youtube_url, video_path
    )
    if not segments:
        _set(engine_job_id, req, "failed", 1.0, status="error",
             error="no transcript available (no captions; Whisper needs audio + key)",
             message="no transcript available")
        return

    _set(engine_job_id, req, "transcribing", 0.4,
         message=f"transcript: {len(segments)} lines")
    windows = transcript.make_windows(segments, target_len=(cfg.min_length + cfg.max_length) / 2)

    # 2. GPT scores the real windows and returns the top real moments
    _set(engine_job_id, req, "analyzing", 0.7, message=f"scoring {len(windows)} moments")
    moments = await asyncio.to_thread(_detect_moments, windows, req, cfg.num_clips)
    if not moments:
        _set(engine_job_id, req, "failed", 1.0, status="error",
             error="moment detection produced nothing (OPENAI_API_KEY required)",
             message="moment detection failed")
        return

    # 3. write real results (render/post pending — never faked)
    r = get_client()
    clip_ids: list[str] = []
    for m in moments:
        clip_id = uuid.uuid4().hex[:10]
        res = ClipResult(
            clip_id=clip_id,
            job_id=req.clippilot_job_id or engine_job_id,
            source_url=req.youtube_url,
            title=(req.title or "Episode") + f" — {m['hook'][:50]}",
            topic=req.topic or m.get("topic", ""),
            hook=m["hook"],
            quote=m.get("quote", ""),
            reason=m.get("reason", ""),
            start_seconds=float(m["start"]),
            end_seconds=float(m["end"]),
            length_seconds=round(float(m["end"]) - float(m["start"]), 1),
            engagement_score=round(float(m["score"]), 4),
            render_status="pending",
            post_status="not_posted",
        )
        r.hset(keys.result_key(clip_id), mapping=res.to_redis())
        r.sadd(keys.RESULTS_SET, clip_id)
        clip_ids.append(clip_id)
        coord("C", "info", f"moment {clip_id} score={res.engagement_score} [{res.start_seconds}-{res.end_seconds}s]")
        # Honest posting handoff: a guaranteed no-op today (render_status="pending"
        # until OpenShorts renders a real vertical short + file). Never fakes a post.
        posted = publish.publish_clip(res, None)
        if posted.post_status != "not_posted":
            r.hset(keys.result_key(clip_id), mapping=posted.to_redis())

    st = get_status(engine_job_id)
    st.clips = clip_ids
    _set(engine_job_id, req, "done", 1.0, message=f"{len(clip_ids)} real moments detected")
    coord("C", "milestone", f"{engine_job_id} done: {len(clip_ids)} real viral moments")


@observability.op("detect_moments")
def _detect_moments(windows: list[dict], req: ProcessRequest, n: int) -> list[dict]:
    """GPT picks the top N real viral moments from the real candidate windows.

    Wrapped as a Weave op so each real GPT virality pass (inputs, output moments, latency,
    token usage) is captured as an LLM trace in Weights & Biases when tracing is enabled.
    """
    if not os.getenv("OPENAI_API_KEY") or not windows:
        return []
    from openai import OpenAI

    compact = [{"i": w["i"], "t": round(w["start"], 1),
                "text": w["text"][:600]} for w in windows]
    prompt = (
        "You are a short-form editor finding the most VIRAL moments in this REAL podcast "
        "transcript. Each candidate window has an index i, start time t (seconds), and "
        f"text. Pick the {n} best self-contained moments. Score 0-1 weighting "
        f"controversy & emotional intensity highest, then humor, then surprising insight "
        f"({', '.join(FACTORS)}). For each return the window index, a verbatim punchy "
        "quote FROM the text, a scroll-stopping hook, a 2-3 word topic, the score, and a "
        "short reason.\n"
        'Return JSON {"moments":[{"i":int,"quote":str,"hook":str,"topic":str,'
        '"score":number,"reason":str}]}.\n'
        f"WINDOWS:\n{json.dumps(compact)}"
    )
    try:
        client = OpenAI()
        resp = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-5.5"),
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},  # gpt-5.x: only default temperature (1)
        )
        picked = json.loads(resp.choices[0].message.content).get("moments", [])
    except Exception as e:
        coord("C", "error", f"moment detection LLM failed: {e}")
        return []

    by_i = {w["i"]: w for w in windows}
    out = []
    for m in picked[:n]:
        w = by_i.get(int(m.get("i", -1)))
        if not w:
            continue
        out.append({
            "start": w["start"], "end": w["end"],
            "quote": m.get("quote", "")[:280], "hook": m.get("hook", ""),
            "topic": m.get("topic", ""), "score": float(m.get("score", 0.5)),
            "reason": m.get("reason", ""),
        })
    return out


# Posting is intentionally NOT implemented here: it requires Upload-Post + platform
# credentials. When those are configured, a publisher would set clip.platform/post_id/
# posted_at and flip post_status -> "posted"; render would set clip_url + render_status
# -> "rendered" via OpenShorts. Until then those fields stay honest.
def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
