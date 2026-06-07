"""Offline test for the engine restart-resume / startup reconcile (Lane C).

Reproduces the real robustness bug: the engine submits a render to OpenShorts, then the
engine PROCESS restarts (its in-memory poll task dies) while OpenShorts keeps rendering and
completes. Before the fix the engine never re-attached, so the job stayed non-terminal and the
orchestrator falsely failed it after 900s. These tests patch ONLY the external OpenShorts call
and prove the reconcile path: resume -> collect clips (captioned) -> mark done (recovering the
clippilot job), and the honest-fail path for a job that never reached OpenShorts.
"""
import asyncio

from conftest import FAKE as _fake

from shared import keys
from shared.redis_client import read_job, write_job
from shared.schemas import EngineStatus, Job, ProcessRequest
from engine import openshorts_client, pipeline


def _reset_engine_memory() -> None:
    """Simulate a process restart: the in-memory job/task state is wiped, only Redis remains."""
    pipeline._ENGINE_JOBS.clear()
    pipeline._RESUMED.clear()


def _fake_collect_clips(job_id, *, title="", topic="", on_progress=None, **kwargs):
    # Mirror a completed OpenShorts job whose clips were already burned with captions.
    if on_progress:
        on_progress("analyzing", "OpenShorts burning captions into clips", 0.9)
    return [
        {"clip_url": f"http://localhost:8010/videos/{job_id}/subtitled_clip_{i}.mp4",
         "filename": f"subtitled_clip_{i}.mp4",
         "start": i * 30.0, "end": i * 30.0 + 24.0,
         "quote": "verbatim line", "hook": f"Hook {i}", "score": 0.9 - i * 0.1}
        for i in range(3)
    ]


def _seed_orphan(engine_job_id: str, *, stage: str, os_job_id: str,
                 clippilot_job_id: str, clippilot_stage: str) -> None:
    """Persist an engine job exactly as the live engine would, then wipe memory (restart)."""
    pipeline._persist(EngineStatus(job_id=engine_job_id, stage=stage, progress=0.65))
    req = ProcessRequest(
        youtube_url="https://www.youtube.com/watch?v=BYXbuik3dgA",
        title="Elon Musk - In 36 months", topic="tech",
        clippilot_job_id=clippilot_job_id,
    )
    pipeline._persist_request(engine_job_id, req)
    if os_job_id:
        pipeline._persist_os_job_id(engine_job_id, os_job_id)
    write_job(
        Job(job_id=clippilot_job_id, episode_url=req.youtube_url, title=req.title,
            topic="tech", stage=clippilot_stage,
            status="error" if clippilot_stage == "failed" else "ok",
            engine_job_id=engine_job_id,
            error="engine timeout after 900s" if clippilot_stage == "failed" else ""),
        _fake,
    )
    _reset_engine_memory()


async def _drive_reconcile() -> int:
    """Run startup reconcile and await any background resume tasks it spawns."""
    n = await pipeline.reconcile_orphans()
    pending = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
    if pending:
        await asyncio.gather(*pending)
    return n


def test_persist_request_and_os_job_id_round_trip():
    """The resume mapping (request + OpenShorts job id) must survive on the engine:job hash."""
    _reset_engine_memory()
    pipeline._persist(EngineStatus(job_id="eng-rt", stage="analyzing", progress=0.65))
    pipeline._persist_request(
        "eng-rt",
        ProcessRequest(youtube_url="https://youtube.com/watch?v=xyz", title="T",
                       topic="tech", clippilot_job_id="job-rt"),
    )
    pipeline._persist_os_job_id("eng-rt", "os-abc-123")

    d = _fake.hgetall("engine:job:eng-rt")
    assert d["youtube_url"] == "https://youtube.com/watch?v=xyz"
    assert d["clippilot_job_id"] == "job-rt"
    assert d["os_job_id"] == "os-abc-123"
    # status writes after submit must NOT clobber the resume fields (hset partial update).
    pipeline._set("eng-rt", ProcessRequest(youtube_url="x"), "fetching", 0.3)
    assert _fake.hgetall("engine:job:eng-rt")["os_job_id"] == "os-abc-123"


def test_restart_resumes_inflight_render_and_recovers_job():
    """Engine restarted mid-render -> reconcile re-attaches to OpenShorts, collects the
    captioned clips, marks the engine job done, and recovers the falsely-failed clippilot job."""
    openshorts_client.collect_clips = _fake_collect_clips
    _seed_orphan("eng-resume1", stage="analyzing", os_job_id="os-d9165c96",
                 clippilot_job_id="job-resume1", clippilot_stage="failed")

    acted = asyncio.run(_drive_reconcile())
    assert acted == 1

    st = pipeline.get_status("eng-resume1")
    assert st.stage == "done", f"{st.stage} {st.error}"
    assert len(st.clips) == 3

    clip_ids = _fake.smembers(keys.RESULTS_SET)
    assert len(clip_ids) == 3
    for cid in clip_ids:
        res = _fake.hgetall(keys.result_key(cid))
        assert res["render_status"] == "rendered"
        assert res["post_status"] == "not_posted"
        assert res["job_id"] == "job-resume1"  # attributed to the clippilot job
        assert "subtitled_" in res["clip_url"]  # captioned file

    # the clippilot job that was falsely marked failed is recovered to done
    job = read_job("job-resume1", _fake)
    assert job.stage == "done", job.stage


def test_orphan_without_openshorts_job_is_failed_not_stranded():
    """A job that died before reaching OpenShorts can't be resumed -> fail it honestly so the
    orchestrator doesn't wait out the full timeout (better than a stranded non-terminal job)."""
    _seed_orphan("eng-noos", stage="fetching", os_job_id="",
                 clippilot_job_id="job-noos", clippilot_stage="fetching")

    acted = asyncio.run(_drive_reconcile())
    assert acted == 1

    assert pipeline.get_status("eng-noos").stage == "failed"
    job = read_job("job-noos", _fake)
    assert job.stage == "failed"
    assert "restarted" in job.error.lower()


def test_reconcile_is_noop_for_terminal_and_empty():
    """Terminal jobs are left untouched and an empty scan acts on nothing (clean no-op)."""
    _reset_engine_memory()
    # no engine jobs at all -> nothing to do
    assert asyncio.run(_drive_reconcile()) == 0

    # already-terminal jobs must not be re-touched
    pipeline._persist(EngineStatus(job_id="eng-done", stage="done", progress=1.0,
                                   clips=["c1"]))
    pipeline._persist(EngineStatus(job_id="eng-failed", stage="failed", progress=1.0,
                                   error="real failure"))
    _reset_engine_memory()
    assert asyncio.run(_drive_reconcile()) == 0
    assert _fake.hget("engine:job:eng-done", "stage") == "done"
    assert _fake.hget("engine:job:eng-failed", "stage") == "failed"
