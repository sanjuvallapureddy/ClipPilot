"""Offline test: Lane B closes the loop (results -> patterns -> Lane A's next config).

Proves the §8 DoD: "Lane B's patterns visibly change Lane A's next pick."
"""
import os

import fakeredis

os.environ["PERFORMANCE_SIMULATE"] = "1"

import shared.redis_client as rc

_fake = fakeredis.FakeStrictRedis(decode_responses=True)
rc.get_client = lambda decode=True: _fake

from shared import keys
from shared.schemas import ClipResult, Patterns
from performance import collector, learn, optimize
from discovery_orchestrator import orchestrator


def _seed_results():
    # Two topics: "ai agents" clips engineered to outperform "crypto" clips.
    data = [
        ("ai agents", 0.9, 30.0, 8), ("ai agents", 0.85, 28.0, 5),
        ("crypto regulation", 0.2, 55.0, 4), ("crypto regulation", 0.15, 58.0, 3),
    ]
    import uuid
    for topic, eng, length, n in data:
        for _ in range(n):
            cid = uuid.uuid4().hex[:10]
            c = ClipResult(clip_id=cid, job_id="j", topic=topic, length_seconds=length,
                           hook=f"The truth about {topic}", engagement_score=eng,
                           platform="tiktok")
            _fake.hset(keys.result_key(cid), mapping=c.to_redis())
            _fake.sadd(keys.RESULTS_SET, cid)


def test_loop_closes():
    _seed_results()

    collector.collect(simulate=True)         # fill realistic metrics (score-correlated)
    patterns = learn.learn()                  # -> patterns:current
    assert isinstance(patterns, Patterns)
    # ai agents engineered to win -> should top winning_topics
    assert patterns.winning_topics[0].startswith("ai agents"), patterns.winning_topics

    n = optimize.generate_variants(patterns.winning_topics)
    assert n >= 1
    vs = _fake.get(keys.variants_key(patterns.winning_topics[0]))
    assert vs and "variants" in vs

    # the learning edge: Lane A's next config reflects learned patterns
    cfg = orchestrator.build_config(orchestrator.read_patterns(_fake))
    assert cfg.topic_bias[0].startswith("ai agents")
    assert cfg.min_length <= cfg.max_length

    print("PASS: results -> patterns:current -> variants -> Lane A config (loop closed)")
    print(f"  winning_topics={patterns.winning_topics}")
    print(f"  next EngineConfig topic_bias={cfg.topic_bias} len={cfg.min_length}-{cfg.max_length}")


if __name__ == "__main__":
    test_loop_closes()
