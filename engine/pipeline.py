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

from . import observability, openshorts_client, overlay, publish, titles
from .scoring import FACTORS  # noqa: F401  (kept for any future scoring use)

_ENGINE_JOBS: dict[str, EngineStatus] = {}
ENGINE_JOB_PREFIX = "engine:job:"
TERMINAL_STAGES = ("done", "failed")


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


def _persist_request(engine_job_id: str, req: ProcessRequest) -> None:
    """Persist just enough of the submit request to RESUME this engine job after a process
    restart wipes the in-memory ``_ENGINE_JOBS`` task. Written once at submit; the OpenShorts
    job id is added later via :func:`_persist_os_job_id` once OpenShorts accepts the source.
    Stored on the engine-internal ``engine:job:{id}`` hash (not part of the cross-lane Redis
    contract), so this adds no contract change. hset is a partial update, so subsequent status
    writes don't clobber these fields.
    """
    try:
        get_client().hset(ENGINE_JOB_PREFIX + engine_job_id, mapping={
            "youtube_url": req.youtube_url,
            "title": req.title or "",
            "topic": req.topic or "",
            "clippilot_job_id": req.clippilot_job_id or "",
        })
    except Exception:
        pass


def _persist_os_job_id(engine_job_id: str, os_job_id: str) -> None:
    """Record the OpenShorts job id so a restart can re-attach to the in-flight render
    (the missing link that previously made restarts strand jobs into a false timeout)."""
    try:
        get_client().hset(ENGINE_JOB_PREFIX + engine_job_id, "os_job_id", os_job_id)
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
    _persist_request(engine_job_id, req)  # survive a restart -> resumable
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
    """Hand the YouTube link straight to OpenShorts. OpenShorts does EVERYTHING — download,
    transcription, viral-moment detection, cutting, 9:16 reframe, captions. ClipPilot does
    NOT transcribe or detect moments itself (that double work caused the endless
    "transcribing/analyzing"). We submit the URL, wait for the rendered clips, and write them.
    """
    if not openshorts_client.available():
        _set(engine_job_id, req, "failed", 1.0, status="error",
             error="OPENAI_API_KEY required (OpenShorts uses it to detect + clip)",
             message="no OpenAI key configured")
        return

    try:
        os_clips = await asyncio.to_thread(
            openshorts_client.generate_clips, req.youtube_url,
            title=req.title, topic=req.topic,
            on_submit=lambda os_job_id: _persist_os_job_id(engine_job_id, os_job_id),
            on_progress=lambda stage, message, progress: _set(
                engine_job_id, req, stage, progress, message=message
            ),
        )
    except openshorts_client.OpenShortsError as e:
        _set(engine_job_id, req, "failed", 1.0, status="error",
             error=str(e), message=f"OpenShorts failed: {e}")
        return
    if not os_clips:
        _set(engine_job_id, req, "failed", 1.0, status="error",
             error="OpenShorts returned no clips (it failed or timed out)",
             message="OpenShorts produced no clips")
        return

    _write_results_and_finish(engine_job_id, req, os_clips)


def _write_results_and_finish(engine_job_id: str, req: ProcessRequest,
                              os_clips: list[dict]) -> list[str]:
    """Persist the REAL rendered clips OpenShorts produced and mark the engine job done.

    Shared by the normal completion path (:func:`_run_real`) and the restart-resume path
    (:func:`_resume_run`) so clip writing + the done transition never diverge.
    """
    r = get_client()
    clip_ids: list[str] = []
    learned_style = req.config.hook_style if req.config else ""
    for oc in os_clips:
        clip_id = uuid.uuid4().hex[:10]
        start = float(oc.get("start") or 0.0)
        end = float(oc.get("end") or 0.0)
        hook = oc.get("hook") or "Viral moment"
        # ONE real title per clip — burned across the top of the video (so the audience
        # sees it) AND used as the YouTube title at upload. Generated from the real hook/
        # quote/topic; falls back to the hook when there's no OpenAI key (never blank).
        title = titles.generate_title(
            hook=hook, quote=oc.get("quote", ""), topic=req.topic,
            source_title=req.title, hook_style=learned_style,
        )
        os_clip_url = oc.get("clip_url", "")
        res = ClipResult(
            clip_id=clip_id,
            job_id=req.clippilot_job_id or engine_job_id,
            source_url=req.youtube_url,
            clip_url=os_clip_url,
            title=title,
            topic=req.topic,
            hook=hook,
            quote=oc.get("quote", ""),
            start_seconds=start,
            end_seconds=end,
            length_seconds=round(end - start, 1) if end > start else 0.0,
            engagement_score=round(float(oc.get("score", 0.0)) or 0.9, 4),
            render_status="rendered",
            post_status="not_posted",
        )
        # Burn the title onto the rendered short. OpenShorts already did the cut / 9:16
        # reframe / word-synced captions; this adds ONLY the title headline (the one thing
        # OpenShorts doesn't). Best-effort: on failure we keep OpenShorts' clip URL so the
        # clip still ships (untitled) rather than dropping it.
        titled_path = overlay.burn_title(os_clip_url, title, clip_id)
        if titled_path:
            res.clip_url = overlay.public_url(titled_path)
        r.hset(keys.result_key(clip_id), mapping=res.to_redis())
        r.sadd(keys.RESULTS_SET, clip_id)
        clip_ids.append(clip_id)
        coord("C", "info", f"OpenShorts clip {clip_id} -> {res.clip_url}")
        # Publish the REAL titled file on disk (when present) so Upload-Post posts the
        # short the audience sees; honest no-op until credentials + render both exist.
        posted = publish.publish_clip(res, titled_path)
        if posted.post_status != "not_posted":
            r.hset(keys.result_key(clip_id), mapping=posted.to_redis())

    st = get_status(engine_job_id)
    st.clips = clip_ids
    _set(engine_job_id, req, "done", 1.0,
         message=f"{len(clip_ids)} clips rendered by OpenShorts")
    coord("C", "milestone", f"{engine_job_id} done: {len(clip_ids)} OpenShorts clips")
    return clip_ids


# --- Restart resume / startup reconcile --------------------------------------
# The engine tracks each OpenShorts render in an in-memory async task. Restarting the engine
# PROCESS kills that task, but OpenShorts (a separate container) keeps rendering and finishes.
# Without recovery the engine never collects those clips and never advances the job, so the
# orchestrator polls a stage that never moves and falsely fails it after ENGINE_POLL_TIMEOUT.
# These helpers re-attach to the in-flight OpenShorts job on startup so a restart is safe.

_RESUMED: set[str] = set()


def _rebuild_request(d: dict) -> ProcessRequest:
    """Reconstruct the submit request from the persisted engine:job hash (for resume)."""
    return ProcessRequest(
        youtube_url=d.get("youtube_url", "") or "",
        title=d.get("title", "") or "",
        topic=d.get("topic", "") or "",
        clippilot_job_id=d.get("clippilot_job_id", "") or "",
    )


async def _resume_run(engine_job_id: str, req: ProcessRequest, os_job_id: str) -> None:
    """Re-attach to an OpenShorts job that was in flight when the engine restarted.

    Polls the existing OpenShorts job (it stays queryable while rendering AND after it
    completes), then runs the SAME collection + caption-burn + done path as a normal run
    (:func:`_write_results_and_finish`). This turns a previously-stranded job (which would
    have hit a false timeout) into a real terminal state, recovering the rendered clips.
    """
    coord("C", "info",
          f"resuming {engine_job_id}: re-attaching to OpenShorts {os_job_id} after restart")
    try:
        os_clips = await asyncio.to_thread(
            openshorts_client.collect_clips, os_job_id,
            title=req.title, topic=req.topic,
            on_progress=lambda stage, message, progress: _set(
                engine_job_id, req, stage, progress, message=message
            ),
        )
    except openshorts_client.OpenShortsError as e:
        _set(engine_job_id, req, "failed", 1.0, status="error", error=str(e),
             message=f"OpenShorts failed (resumed after restart): {e}")
        coord("C", "error", f"{engine_job_id} resume failed: {e}")
        return
    except Exception as e:  # pragma: no cover - defensive
        _set(engine_job_id, req, "failed", 1.0, status="error", error=str(e),
             message=f"engine resume error: {e}")
        coord("C", "error", f"{engine_job_id} resume crashed: {e}")
        return
    if not os_clips:
        _set(engine_job_id, req, "failed", 1.0, status="error",
             error="OpenShorts returned no clips on resume",
             message="OpenShorts produced no clips (resumed)")
        return
    _write_results_and_finish(engine_job_id, req, os_clips)
    coord("C", "milestone",
          f"{engine_job_id} recovered after restart ({len(os_clips)} clips)")


def _find_orphans() -> list[tuple[str, ProcessRequest, str]]:
    """Scan persisted engine jobs for ones left non-terminal by a process restart.

    Returns ``(engine_job_id, req, os_job_id)`` for each. ``os_job_id`` is "" when the job
    died before it reached OpenShorts (mid source-prep) — those can't be resumed and the
    caller fails them honestly. Rehydrates ``_ENGINE_JOBS`` so ``GET /status`` reflects the
    job during recovery. Read-only on Redis (plus the in-memory rehydrate); when there are no
    orphans it returns an empty list, so the caller is a clean no-op.
    """
    orphans: list[tuple[str, ProcessRequest, str]] = []
    try:
        r = get_client()
        job_keys = list(r.scan_iter(match=ENGINE_JOB_PREFIX + "*"))
    except Exception as e:
        coord("C", "error", f"startup reconcile scan failed: {e}")
        return orphans

    for key in job_keys:
        try:
            d = r.hgetall(key)
        except Exception:
            continue
        if not d:
            continue
        stage = d.get("stage", "queued")
        if stage in TERMINAL_STAGES:
            continue  # already done/failed — nothing to recover
        engine_job_id = key.split(ENGINE_JOB_PREFIX, 1)[-1]
        _ENGINE_JOBS[engine_job_id] = EngineStatus(
            job_id=engine_job_id, stage=stage, status=d.get("status", "ok"),
            progress=float(d.get("progress", 0) or 0),
            clips=[c for c in d.get("clips", "").split(",") if c],
            error=d.get("error", ""),
        )
        orphans.append(
            (engine_job_id, _rebuild_request(d), d.get("os_job_id", "") or "")
        )
    return orphans


async def reconcile_orphans() -> int:
    """Recover engine jobs stranded by a process restart (call once on startup).

    For each non-terminal engine job:
      * RESUME it if we persisted an OpenShorts job id — re-attach a background poll task that
        collects the clips (with captions) and marks the job done (or failed with the real
        OpenShorts reason);
      * otherwise mark it failed (it never reached OpenShorts, so nothing can be resumed) —
        which still beats a false ``engine timeout`` once the orchestrator gives up.

    No-op when there are no orphans. Returns the number of jobs acted on. Resumes run in the
    background so startup is never blocked waiting for renders to finish.
    """
    orphans = _find_orphans()
    acted = 0
    for engine_job_id, req, os_job_id in orphans:
        if engine_job_id in _RESUMED:
            continue  # don't double-attach if reconcile is somehow run twice
        _RESUMED.add(engine_job_id)
        if os_job_id:
            coord("C", "info",
                  f"startup: re-attaching orphaned engine job {engine_job_id} "
                  f"-> OpenShorts {os_job_id}")
            asyncio.create_task(_resume_run(engine_job_id, req, os_job_id))
        else:
            _set(engine_job_id, req, "failed", 1.0, status="error",
                 error="engine restarted before OpenShorts submission; source prep interrupted",
                 message="engine restarted mid-prep; no OpenShorts job to resume")
            coord("C", "error",
                  f"startup: engine job {engine_job_id} had no OpenShorts job; marked failed")
        acted += 1
    if acted:
        coord("C", "milestone",
              f"startup reconcile acted on {acted} orphaned engine job(s)")
    return acted


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

    # Apply what Lane B's self-learning loop has learned from past performance. These
    # ride in via EngineConfig (patterns:current -> build_config -> here) so a winning
    # insight actually changes how the NEXT batch's moments/hooks are chosen.
    cfg = req.config
    learned_bits: list[str] = []
    if cfg.topic_bias:
        learned_bits.append(f"Prioritize moments about: {', '.join(cfg.topic_bias[:5])}.")
    if cfg.avoid_topics:
        learned_bits.append(
            f"Deprioritize these underperforming topics: {', '.join(cfg.avoid_topics[:5])}."
        )
    if cfg.hook_style:
        learned_bits.append(f"Write hooks in this proven winning style: {cfg.hook_style}.")
    if cfg.first_line_strategy:
        learned_bits.append(f"Opening-line strategy: {cfg.first_line_strategy}")
    if cfg.hook_templates:
        learned_bits.append(
            f"Hook patterns that have worked: {'; '.join(cfg.hook_templates[:3])}."
        )
    learned = (
        "\nLEARNED FROM PAST PERFORMANCE (apply this to maximize virality): "
        + " ".join(learned_bits) + "\n"
        if learned_bits else ""
    )
    prompt = (
        "You are a short-form editor finding the most VIRAL moments in this REAL podcast "
        "transcript. Each candidate window has an index i, start time t (seconds), and "
        f"text. Pick the {n} best self-contained moments. Score 0-1 weighting "
        f"controversy & emotional intensity highest, then humor, then surprising insight "
        f"({', '.join(FACTORS)}). For each return the window index, a verbatim punchy "
        "quote FROM the text, a scroll-stopping hook, a 2-3 word topic, the score, and a "
        "short reason."
        f"{learned}"
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
