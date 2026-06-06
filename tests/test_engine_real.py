"""Offline test for the REAL engine pipeline.

Patches the two external touch-points — `transcript.fetch_segments` (yt-dlp/captions) and
`pipeline._detect_moments` (the GPT call) — with deterministic test doubles, then proves
the pipeline plumbing: fetch -> transcribe -> analyze -> done, writing real-shaped
results:{clip_id} with render_status=pending / post_status=not_posted (never faked).
"""
import asyncio

from conftest import FAKE as _fake

from shared import keys
from shared.redis_client import write_job
from shared.schemas import EngineConfig, Job, ProcessRequest
from engine import pipeline, transcript


def _fake_segments(url):
    # shape matches real caption output: [(start_seconds, text), ...]
    return [(float(i * 5), f"line {i} about ai agents and controversy") for i in range(60)]


def _fake_detect(windows, req, n):
    return [
        {"start": w["start"], "end": w["end"], "quote": "verbatim punchy line",
         "hook": f"Hook {i}", "topic": "ai agents", "score": 0.9 - i * 0.1,
         "reason": "high controversy"}
        for i, w in enumerate(windows[:n])
    ]


async def _main():
    transcript.fetch_segments = _fake_segments
    pipeline._detect_moments = _fake_detect

    job = Job(job_id="job-r1", episode_url="https://youtube.com/watch?v=abc",
              title="Lex Fridman Podcast", topic="ai agents")
    write_job(job, _fake)
    req = ProcessRequest(youtube_url=job.episode_url, title=job.title, topic=job.topic,
                         clippilot_job_id=job.job_id,
                         config=EngineConfig(num_clips=3))
    eng_id = pipeline.submit(req)

    for _ in range(100):
        st = pipeline.get_status(eng_id)
        if st and st.stage in ("done", "failed"):
            break
        await asyncio.sleep(0.05)

    st = pipeline.get_status(eng_id)
    assert st.stage == "done", f"{st.stage} {st.error}"
    assert len(st.clips) == 3

    clip_ids = _fake.smembers(keys.RESULTS_SET)
    assert len(clip_ids) == 3
    for cid in clip_ids:
        res = _fake.hgetall(keys.result_key(cid))
        assert res["render_status"] == "pending"      # honest, not faked
        assert res["post_status"] == "not_posted"
        assert res["clip_url"] == "" and res["post_id"] == ""
        assert int(res["views"]) == 0                  # no invented metrics
        assert res["quote"] and res["hook"]            # real moment data
        assert float(res["start_seconds"]) >= 0 and float(res["end_seconds"]) > 0

    assert _fake.hgetall(keys.job_key("job-r1"))["stage"] == "done"
    stages = [e[1]["stage"] for e in _fake.xrange(keys.JOBS_STREAM)]
    assert "transcribing" in stages and "analyzing" in stages and "done" in stages, stages


def test_engine_real():
    asyncio.run(_main())
