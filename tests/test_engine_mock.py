"""Offline smoke test for Lane C MOCK pipeline using fakeredis.

Proves: POST /process semantics -> job walks stages -> results:{clip_id} written
with sandbox post ids -> jobs:{id} advanced to done. Run: .venv/bin/python -m pytest -q
(or just `.venv/bin/python tests/test_engine_mock.py`).
"""
import asyncio
import os

import fakeredis

os.environ["ENGINE_MODE"] = "MOCK"

import shared.redis_client as rc

_fake = fakeredis.FakeStrictRedis(decode_responses=True)
rc.get_client = lambda decode=True: _fake  # patch the single connection point

from shared import keys
from shared.redis_client import write_job
from shared.schemas import EngineConfig, Job, ProcessRequest
from engine import pipeline


async def _main():
    # Lane A would create the job; simulate that
    job = Job(job_id="job-test1", episode_url="https://youtube.com/watch?v=abc",
              title="All-In", topic="ai agents")
    write_job(job, _fake)

    req = ProcessRequest(
        youtube_url=job.episode_url, title=job.title, topic=job.topic,
        clippilot_job_id=job.job_id,
        config=EngineConfig(num_clips=3, topic_bias=["ai agents"], platforms=["tiktok"]),
    )
    eng_id = pipeline.submit(req)
    assert eng_id.startswith("eng-")

    # poll until done
    for _ in range(100):
        st = pipeline.get_status(eng_id)
        if st and st.stage in ("done", "failed"):
            break
        await asyncio.sleep(0.1)

    st = pipeline.get_status(eng_id)
    assert st.stage == "done", f"engine stage={st.stage} err={st.error}"
    assert len(st.clips) == 3, st.clips

    # contract assertions
    clip_ids = _fake.smembers(keys.RESULTS_SET)
    assert len(clip_ids) == 3
    for cid in clip_ids:
        res = _fake.hgetall(keys.result_key(cid))
        assert res["post_id"].startswith("sandbox-")
        assert res["clip_url"].endswith(".mp4")
        assert float(res["engagement_score"]) >= 0

    final_job = _fake.hgetall(keys.job_key("job-test1"))
    assert final_job["stage"] == "done", final_job

    events = _fake.xrange(keys.JOBS_STREAM)
    stages_seen = [e[1]["stage"] for e in events]
    assert "rendering" in stages_seen and "done" in stages_seen, stages_seen

    print("PASS: engine MOCK pipeline honored full contract")
    print(f"  engine_job={eng_id}  clips={len(clip_ids)}  job_stages={stages_seen}")


def test_engine_mock():
    asyncio.run(_main())


if __name__ == "__main__":
    asyncio.run(_main())
