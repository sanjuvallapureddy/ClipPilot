"""Offline test for the REAL engine wrapper.

Patches only the external OpenShorts call with deterministic test doubles, then proves
the pipeline plumbing: source handoff -> OpenShorts render -> done/failure, writing
real-shaped results:{clip_id} with render_status=rendered / post_status=not_posted.
"""
import asyncio

from conftest import FAKE as _fake

from shared import keys
from shared.redis_client import write_job
from shared.schemas import EngineConfig, Job, ProcessRequest
from engine import openshorts_client, pipeline


def _fake_generate_clips(url, *, title="", topic="", on_progress=None, **kwargs):
    if on_progress:
        on_progress("fetching", "checking source video", 0.15)
        on_progress("fetching", "OpenShorts downloading source video", 0.35)
        on_progress("transcribing", "OpenShorts transcribing source", 0.45)
        on_progress("analyzing", "OpenShorts detecting viral moments", 0.65)
    return [
        {"clip_url": f"http://localhost:8010/videos/test/clip_{i}.mp4",
         "start": i * 30.0, "end": i * 30.0 + 24.0,
         "quote": "verbatim punchy line", "hook": f"Hook {i}", "score": 0.9 - i * 0.1}
        for i in range(3)
    ]


async def _run_job(job_id="job-r1"):
    job = Job(job_id=job_id, episode_url="https://youtube.com/watch?v=abc",
              title="Lex Fridman Podcast", topic="ai agents")
    write_job(job, _fake)
    req = ProcessRequest(youtube_url=job.episode_url, title=job.title, topic=job.topic,
                         clippilot_job_id=job.job_id,
                         config=EngineConfig(num_clips=3))
    eng_id = pipeline.submit(req)

    for _ in range(100):
        st = pipeline.get_status(eng_id)
        if st and st.stage in ("done", "failed"):
            return st
        await asyncio.sleep(0.05)

    return pipeline.get_status(eng_id)


async def _main_success():
    openshorts_client.available = lambda: True
    openshorts_client.generate_clips = _fake_generate_clips

    st = await _run_job()
    assert st.stage == "done", f"{st.stage} {st.error}"
    assert len(st.clips) == 3

    clip_ids = _fake.smembers(keys.RESULTS_SET)
    assert len(clip_ids) == 3
    for cid in clip_ids:
        res = _fake.hgetall(keys.result_key(cid))
        assert res["render_status"] == "rendered"
        assert res["post_status"] == "not_posted"
        assert res["clip_url"].startswith("http://localhost:8010/videos/test/")
        assert int(res["views"]) == 0
        assert res["quote"] and res["hook"]
        assert float(res["start_seconds"]) >= 0 and float(res["end_seconds"]) > 0

    assert _fake.hgetall(keys.job_key("job-r1"))["stage"] == "done"
    stages = [e[1]["stage"] for e in _fake.xrange(keys.JOBS_STREAM)]
    assert stages.index("fetching") < stages.index("transcribing") < stages.index("analyzing")
    assert stages[-1] == "done", stages


async def _main_failure():
    openshorts_client.available = lambda: True

    def fail(*args, **kwargs):
        raise openshorts_client.OpenShortsError("source video is 84.2 minutes")

    openshorts_client.generate_clips = fail
    st = await _run_job("job-fail")
    assert st.stage == "failed"
    assert "84.2 minutes" in st.error
    stored = _fake.hgetall(keys.job_key("job-fail"))
    assert stored["stage"] == "failed"
    assert "84.2 minutes" in stored["error"]


def test_engine_real():
    asyncio.run(_main_success())


def test_engine_surfaces_openshorts_failure():
    asyncio.run(_main_failure())


def test_long_source_is_bounded_before_openshorts(monkeypatch):
    progress = []

    # No heatmap available -> fall back to the caption-based window selection (never a
    # 30-minute chunk). Disable the most-replayed path so we don't hit the network.
    monkeypatch.setattr(openshorts_client.most_replayed, "enabled", lambda: False)
    monkeypatch.setattr(openshorts_client, "_source_duration_seconds", lambda url: 7200)
    monkeypatch.setattr(
        openshorts_client,
        "_select_segment_window",
        lambda url, title="", topic="", max_duration=120: (480.0, 600.0),
    )
    monkeypatch.setattr(
        openshorts_client.download,
        "download_section",
        lambda url, start, end, suffix="segment": "media/abc_segment_480_600.mp4",
    )

    bounded = openshorts_client._prepare_bounded_source(
        "https://youtube.com/watch?v=abc",
        title="AI jobs debate",
        topic="AI jobs debate",
        window_seconds=120,
        on_progress=lambda stage, message, pct: progress.append((stage, message, pct)),
    )

    assert bounded == "http://localhost:8001/media/abc_segment_480_600.mp4"
    assert any("selecting best" in message for _, message, _ in progress)
    assert any("downloading source segment" in message for _, message, _ in progress)
