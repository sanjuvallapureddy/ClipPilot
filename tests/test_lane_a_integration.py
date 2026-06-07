"""Offline integration test: Lane A (discovery + orchestrator) -> Lane C (engine).

Uses the shared fakeredis (conftest) and a fake httpx transport that runs the REAL
engine pipeline in-process. Proves run_once: discover -> queue -> dedupe -> job ->
engine -> results -> job done; and the learning edge (patterns:current biases config).
"""
import asyncio
import uuid

from conftest import FAKE as _fake

from shared import keys
from shared.schemas import DiscoveryItem, EngineStatus, Patterns, ProcessRequest
from engine import openshorts_client, pipeline
from discovery_orchestrator import orchestrator


def _fake_generate_clips(url, *, title="", topic="", on_progress=None, **kwargs):
    if on_progress:
        on_progress("fetching", "checking source video", 0.15)
        on_progress("fetching", "OpenShorts downloading source video", 0.35)
        on_progress("transcribing", "OpenShorts transcribing source", 0.45)
        on_progress("analyzing", "OpenShorts detecting viral moments", 0.65)
    return [
        {"clip_url": f"http://localhost:8010/videos/test/clip_{i}.mp4",
         "start": i * 30.0, "end": i * 30.0 + 24.0,
         "quote": "q", "hook": f"H{i}", "score": 0.8}
        for i in range(3)
    ]


class _Resp:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self):
        return None

    def json(self):
        return self._data


class _FakeClient:
    def __init__(self, *a, **k):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def post(self, url, json=None):
        req = ProcessRequest(**json)
        engine_job_id = "eng-" + uuid.uuid4().hex[:8]
        pipeline._persist(EngineStatus(job_id=engine_job_id, stage="queued"))
        asyncio.run(pipeline._run_real(engine_job_id, req))  # real engine code
        return _Resp({"job_id": engine_job_id})

    def get(self, url):
        eng_id = url.rsplit("/", 1)[-1]
        st = pipeline.get_status(eng_id)
        return _Resp(st.model_dump() if st else {"stage": "failed", "clips": []})


def test_run_once_end_to_end():
    orchestrator.httpx.Client = _FakeClient
    openshorts_client.available = lambda: True
    openshorts_client.generate_clips = _fake_generate_clips

    p = Patterns(winning_topics=["ai agents and autonomous software"],
                 ideal_length_min=25.0, ideal_length_max=35.0,
                 caption_style="big-yellow", hook_templates=["The truth about {topic}"])
    _fake.set(keys.PATTERNS_CURRENT, p.to_json())

    cfg = orchestrator.build_config(orchestrator.read_patterns(_fake))
    assert cfg.min_length == 25.0 and cfg.max_length == 35.0
    assert cfg.caption_style == "big-yellow"
    assert "ai agents and autonomous software" in cfg.topic_bias  # learning edge proven

    # seed one real-shaped discovery item so run_once doesn't hit the network for discovery
    item = DiscoveryItem(youtube_url="https://youtube.com/watch?v=real1",
                         title="Lex Fridman: AI agents", podcast="Lex Fridman",
                         topic="ai agents", trend_score=0.88, source="youtube")
    _fake.xadd(keys.DISCOVERY_QUEUE, item.to_redis())

    result = orchestrator.run_once(topic="tech")
    assert result["status"] == "ok", result
    assert result["stage"] == "done", result

    job = _fake.hgetall(keys.job_key(result["job_id"]))
    assert job["stage"] == "done"
    assert job["engine_job_id"].startswith("eng-")

    clip_ids = _fake.smembers(keys.RESULTS_SET)
    assert len(clip_ids) >= 1
    sample = _fake.hgetall(keys.result_key(next(iter(clip_ids))))
    assert sample["post_id"] == "" and sample["post_status"] == "not_posted"
    assert sample["render_status"] == "rendered"
    assert sample["clip_url"].startswith("http://localhost:8010/videos/test/")
    stages = [e[1]["stage"] for e in _fake.xrange(keys.JOBS_STREAM)]
    assert stages.index("fetching") < stages.index("transcribing") < stages.index("analyzing")

    # dedupe: same video skipped on a second pass
    item = DiscoveryItem(youtube_url=job["episode_url"], title="dup", trend_score=0.9)
    assert orchestrator.process_item(item, p) is None
