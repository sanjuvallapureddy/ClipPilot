"""Engine pipeline runner (Lane C).

Bridges the ClipPilot contract to OpenShorts. Two modes:

  MOCK  — simulate ingest→transcribe→score→cut→reframe→caption→publish without heavy
          deps, but honor the FULL contract: walk job stages, write results:{clip_id}
          skeletons with post ids, emit jobs:stream events. Demo-safe, zero keys.

  REAL  — call vendored OpenShorts (engine/openshorts) for the actual pipeline +
          Upload-Post publishing, then write the same contract outputs.

We do NOT reimplement OpenShorts' steps. MOCK just fakes their *outputs*; REAL delegates.
"""
from __future__ import annotations

import asyncio
import os
import time
import uuid

from shared import keys
from shared.redis_client import advance_job, coord, get_client, read_job
from shared.schemas import ClipResult, EngineStatus, ProcessRequest

from .scoring import score_segment

# In-memory engine job registry (also mirrored to Redis hash engine:job:{id}).
_ENGINE_JOBS: dict[str, EngineStatus] = {}

ENGINE_JOB_PREFIX = "engine:job:"

# Fake transcript segments used in MOCK mode so scoring has something to chew on.
_MOCK_SEGMENTS = [
    "I genuinely think most VCs have no idea what they're funding in AI right now.",
    "The longevity stuff is mostly hype — but ONE thing actually works.",
    "He said founders should never raise on a flat round. That's wrong, here's why.",
    "AGI in two years? That's either delusional or the understatement of the decade.",
    "Crypto regulation is coming and 90% of these tokens won't survive it.",
]


def _persist(status: EngineStatus) -> None:
    _ENGINE_JOBS[status.job_id] = status
    try:
        r = get_client()
        r.hset(ENGINE_JOB_PREFIX + status.job_id, mapping={
            "stage": status.stage, "status": status.status,
            "progress": str(status.progress), "error": status.error,
            "clips": ",".join(status.clips),
        })
    except Exception:
        pass


def get_status(engine_job_id: str) -> EngineStatus | None:
    if engine_job_id in _ENGINE_JOBS:
        return _ENGINE_JOBS[engine_job_id]
    # rehydrate from Redis if process restarted
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
    """Register an engine job and kick off processing. Returns engine_job_id."""
    engine_job_id = "eng-" + uuid.uuid4().hex[:8]
    status = EngineStatus(job_id=engine_job_id, stage="queued", progress=0.0)
    _persist(status)
    coord("C", "info", f"engine accepted {engine_job_id} for {req.youtube_url}")
    asyncio.create_task(_run(engine_job_id, req))
    return engine_job_id


async def _run(engine_job_id: str, req: ProcessRequest) -> None:
    mode = os.getenv("ENGINE_MODE", "MOCK").upper()
    try:
        if mode == "REAL":
            await _run_real(engine_job_id, req)
        else:
            await _run_mock(engine_job_id, req)
    except Exception as e:  # pragma: no cover
        st = get_status(engine_job_id) or EngineStatus(job_id=engine_job_id, stage="failed")
        st.stage = "failed"
        st.status = "error"
        st.error = str(e)
        _persist(st)
        _advance_caller(req, "failed", status="error", error=str(e))
        coord("C", "error", f"{engine_job_id} failed: {e}")


def _advance_caller(req: ProcessRequest, stage: str, status: str = "ok",
                    error: str = "", message: str = "") -> None:
    """If Lane A passed its job_id, advance jobs:{id} too (A & C write jobs)."""
    if not req.clippilot_job_id:
        return
    job = read_job(req.clippilot_job_id)
    if job:
        advance_job(job, stage, message=message or f"engine: {stage}", status=status, error=error)


async def _run_mock(engine_job_id: str, req: ProcessRequest) -> None:
    cfg = req.config
    trends = cfg.topic_bias or ([req.topic] if req.topic else [])
    r = get_client()

    stage_plan = [
        ("submitted", 0.1, 0.3),
        ("rendering", 0.6, 1.2),   # ingest+transcribe+score+cut+reframe+caption
        ("publishing", 0.9, 0.6),
    ]
    for stage, progress, delay in stage_plan:
        st = get_status(engine_job_id)
        st.stage, st.progress = stage, progress
        _persist(st)
        _advance_caller(req, stage)
        await asyncio.sleep(delay)

    # score mock segments, pick top N, write results skeletons with post ids
    scored = sorted(
        ((s, score_segment(s, trends, cfg.scoring_provider)) for s in _MOCK_SEGMENTS),
        key=lambda x: x[1].overall, reverse=True,
    )[: cfg.num_clips]

    clip_ids: list[str] = []
    for seg, ms in scored:
        clip_id = uuid.uuid4().hex[:10]
        platform = cfg.platforms[0] if cfg.platforms else "tiktok"
        length = round((cfg.min_length + cfg.max_length) / 2, 1)
        res = ClipResult(
            clip_id=clip_id,
            job_id=req.clippilot_job_id or engine_job_id,
            clip_url=f"https://cdn.clippilot.dev/{clip_id}.mp4",
            platform=platform,
            post_id="sandbox-" + uuid.uuid4().hex[:10],   # Upload-Post sandbox id
            posted_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            title=(req.title or "Podcast clip") + f" — {ms.hook[:40]}",
            topic=req.topic,
            hook=ms.hook,
            length_seconds=length,
            engagement_score=ms.overall,  # seed; Lane B refines from real metrics
        )
        r.hset(keys.result_key(clip_id), mapping=res.to_redis())
        r.sadd(keys.RESULTS_SET, clip_id)
        clip_ids.append(clip_id)
        coord("C", "info", f"clip {clip_id} -> {platform} (sandbox) score={ms.overall}")

    st = get_status(engine_job_id)
    st.stage, st.progress, st.clips = "done", 1.0, clip_ids
    _persist(st)
    _advance_caller(req, "done", message=f"{len(clip_ids)} clips published (sandbox)")
    coord("C", "milestone", f"{engine_job_id} done: {len(clip_ids)} clips")


async def _run_real(engine_job_id: str, req: ProcessRequest) -> None:  # pragma: no cover
    """Delegate to vendored OpenShorts. Wraps its pipeline; does not reimplement it.

    NOTE (riskiest integration): the exact OpenShorts entrypoint must be verified once
    the repo is vendored under engine/openshorts. The block below shows the intended
    wiring; adjust import paths to match OpenShorts' actual public functions and post
    the change to coord:log per §6.
    """
    st = get_status(engine_job_id)
    st.stage, st.progress = "rendering", 0.3
    _persist(st)
    _advance_caller(req, "rendering")

    # --- intended OpenShorts wiring (verify against vendored repo) ---
    # from engine.openshorts.pipeline import process_video  # TODO verify path
    # result = await asyncio.to_thread(
    #     process_video,
    #     url=req.youtube_url,
    #     num_clips=req.config.num_clips,
    #     min_len=req.config.min_length, max_len=req.config.max_length,
    #     scoring_prompt=PODCAST_SCORING_PROMPT, provider=req.config.scoring_provider,
    #     publish=True, platforms=req.config.platforms,
    #     upload_post_key=os.getenv("UPLOAD_POST_API_KEY"),
    #     sandbox=os.getenv("UPLOAD_POST_SANDBOX", "1") == "1",
    # )
    # then map result.clips -> ClipResult hashes + results:all set, advance to done.
    raise NotImplementedError(
        "ENGINE_MODE=REAL requires vendored OpenShorts under engine/openshorts. "
        "See engine/README.md. Run with ENGINE_MODE=MOCK for the demo."
    )
