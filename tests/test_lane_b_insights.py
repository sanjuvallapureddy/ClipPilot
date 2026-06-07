"""Offline tests: the self-learning loop (Lane B v2).

Proves the new comparator (1) ranks on the best REAL signal, (2) explains why the winner
won, (3) auto-applies the lesson into patterns:current so Lane A's NEXT config changes, and
(4) never invents a view count — the predicted-virality path leaves real `views` at 0.
"""
import json
import uuid

import pytest
from conftest import FAKE as _fake

from shared import keys
from shared.schemas import ClipResult, LearningInsight
from performance import insights
from discovery_orchestrator import orchestrator


@pytest.fixture(autouse=True)
def _force_offline(monkeypatch):
    # Deterministic heuristic path (no network); also no fake metrics source.
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("UPLOAD_POST_API_KEY", raising=False)


def _add(clip: ClipResult) -> None:
    _fake.hset(keys.result_key(clip.clip_id), mapping=clip.to_redis())
    _fake.sadd(keys.RESULTS_SET, clip.clip_id)


def _seed_predicted():
    """Real GPT predicted-virality scores only — nothing posted yet (views stay 0)."""
    rows = [
        ("ai agents", 0.90, 30.0, "Why nobody talks about ai agents"),
        ("ai agents", 0.85, 28.0, "The truth about ai agents"),
        ("crypto regulation", 0.20, 55.0, "A measured look at crypto regulation"),
        ("crypto regulation", 0.15, 58.0, "Some thoughts on crypto regulation"),
    ]
    for topic, eng, length, hook in rows:
        _add(ClipResult(
            clip_id=uuid.uuid4().hex[:10], job_id="j", topic=topic, hook=hook,
            length_seconds=length, engagement_score=eng, platform="tiktok",
        ))


def test_predicted_virality_insight_explains_and_persists():
    _seed_predicted()

    insight = insights.run_insight()
    assert isinstance(insight, LearningInsight)
    assert insight.signal_source == "predicted_virality"
    assert insight.winner_signal == 0.9
    assert insight.loser_signal == 0.15
    assert insight.winner_signal > insight.loser_signal
    # explainability: a real "why", concrete factors + recommendations
    assert insight.why and "0.90" in insight.why and "0.15" in insight.why
    assert insight.factors, "expected at least one driving factor"
    assert insight.recommendations, "expected concrete recommendations"
    assert insight.applied, "expected auto-applied changes"

    # persisted for the dashboard + audit trail
    raw = _fake.get(keys.INSIGHTS_LATEST)
    assert raw, "insights:latest must be written"
    assert json.loads(raw)["insight_id"] == insight.insight_id
    assert _fake.xlen(keys.INSIGHTS_STREAM) == 1


def test_insight_auto_applies_to_next_config():
    _seed_predicted()
    insights.run_insight()

    patterns = orchestrator.read_patterns(_fake)
    # winner's topic promoted, loser's topic deprioritized, hook style learned
    assert patterns.winning_topics[0] == "ai agents"
    assert "crypto regulation" in patterns.avoid_topics
    assert patterns.hook_style, "a winning hook_style should be learned"
    assert patterns.insight_summary, "the why should be saved onto patterns"

    # the learning visibly changes Lane A's NEXT EngineConfig (the feedback edge)
    cfg = orchestrator.build_config(patterns)
    assert cfg.topic_bias[0] == "ai agents"
    assert "crypto regulation" in cfg.avoid_topics
    assert cfg.hook_style == patterns.hook_style
    assert cfg.first_line_strategy == patterns.first_line_strategy
    assert cfg.min_length <= cfg.max_length


def test_never_invents_views_on_predicted_path():
    _seed_predicted()
    insights.run_insight()

    # REAL-DATA-ONLY: with nothing posted, no clip's view count may be fabricated.
    for cid in _fake.smembers(keys.RESULTS_SET):
        assert _fake.hget(keys.result_key(cid), "views") == "0"


def test_real_views_signal_only_compares_posted_clips():
    # Two clips actually posted with REAL view counts (the 30k vs 10k example)...
    _add(ClipResult(clip_id="win", job_id="j", topic="ai agents",
                    hook="Why nobody talks about ai agents", length_seconds=30.0,
                    engagement_score=0.7, platform="tiktok", post_status="posted",
                    views=30000, likes=1800, shares=400, watch_time=22.0))
    _add(ClipResult(clip_id="lose", job_id="j", topic="crypto regulation",
                    hook="A measured look at crypto regulation", length_seconds=55.0,
                    engagement_score=0.65, platform="tiktok", post_status="posted",
                    views=10000, likes=300, shares=40, watch_time=12.0))
    # ...plus an UNPOSTED clip with a high predicted score but zero real views. It must
    # NOT be treated as a loser — real views are only compared among posted clips.
    _add(ClipResult(clip_id="ghost", job_id="j", topic="quantum", hook="quantum hype",
                    length_seconds=40.0, engagement_score=0.99, post_status="not_posted",
                    views=0))

    insight = insights.run_insight()
    assert insight is not None
    assert insight.signal_source == "real_views"
    assert insight.winner_clip_id == "win" and insight.winner_signal == 30000.0
    assert insight.loser_clip_id == "lose" and insight.loser_signal == 10000.0
    assert "30,000 views" in insight.why and "10,000 views" in insight.why


def test_needs_two_comparable_clips():
    _add(ClipResult(clip_id="solo", job_id="j", topic="ai agents", hook="h",
                    length_seconds=30.0, engagement_score=0.9))
    assert insights.run_insight() is None
    assert _fake.get(keys.INSIGHTS_LATEST) is None
