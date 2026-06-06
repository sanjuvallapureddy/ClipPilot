"""Offline integration test: Lane A (discovery + orchestrator) -> Lane C (engine).

Uses fakeredis for the contract and a fake httpx transport that runs the REAL engine
pipeline in-process. Proves run_once: discover -> queue -> dedupe -> job -> engine ->
results -> job done. Also proves the learning edge: patterns:current biases EngineConfig.

IMPORTANT: get_client is patched BEFORE importing lane modules so their
`from shared.redis_client import get_client` bindings capture the fake.
"""
import asyncio
import os
import uuid

import fakeredis

os.environ["ENGINE_MODE"] = "MOCK"
os.environ["DISCOVERY_TOP_N"] = "5"

import shared.redis_client as rc

_fake = fakeredis.FakeStrictRedis(decode_responses=True)
rc.get_client = lambda decode=True: _fake  # patch the single connection point first

# now import lane modules so they bind the patched get_client
from shared import keys
from shared.schemas import EngineStatus, ProcessRequest
from engine import pipeline
from discovery_orchestrator import orchestrator


# --- fake HTTP transport: route orchestrator's httpx calls to engine in-process ---
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
        asyncio.run(pipeline._run_mock(engine_job_id, req))  # real engine code
        return _Resp({"job_id": engine_job_id})

    def get(self, url):
        eng_id = url.rsplit("/", 1)[-1]
        st = pipeline.get_status(eng_id)
        return _Resp(st.model_dump() if st else {"stage": "failed", "clips": []})


def test_run_once_end_to_end():
    orchestrator.httpx.Client = _FakeClient  # patch the client used in orchestrator

    # seed learned patterns so we can prove they bias the engine config
    from shared.schemas import Patterns
    p = Patterns(winning_topics=["ai agents and autonomous software"],
                 ideal_length_min=25.0, ideal_length_max=35.0,
                 caption_style="big-yellow", hook_templates=["The truth about {topic}"])
    _fake.set(keys.PATTERNS_CURRENT, p.to_json())

    cfg = orchestrator.build_config(orchestrator.read_patterns(_fake))
    assert cfg.min_length == 25.0 and cfg.max_length == 35.0
    assert cfg.caption_style == "big-yellow"
    assert "ai agents and autonomous software" in cfg.topic_bias  # learning edge proven

    result = orchestrator.run_once(topic="tech")
    assert result["status"] == "ok", result
    assert result["stage"] == "done", result

    # contract checks
    job = _fake.hgetall(keys.job_key(result["job_id"]))
    assert job["stage"] == "done"
    assert job["engine_job_id"].startswith("eng-")

    clip_ids = _fake.smembers(keys.RESULTS_SET)
    assert len(clip_ids) >= 1
    sample = _fake.hgetall(keys.result_key(next(iter(clip_ids))))
    assert sample["post_id"].startswith("sandbox-")

    # dedupe: same video should be skipped on a second pass
    from shared.schemas import DiscoveryItem
    item = DiscoveryItem(youtube_url=job["episode_url"], title="dup", trend_score=0.9)
    assert orchestrator.process_item(item, p) is None  # already seen

    print("PASS: Lane A discover->orchestrate->engine->results; patterns bias config; dedupe works")
    print(f"  job={result['job_id']} stage={result['stage']} clips={len(clip_ids)}")


if __name__ == "__main__":
    test_run_once_end_to_end()
