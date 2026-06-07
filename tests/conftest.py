"""Shared offline test fixtures.

Patches the single Redis connection point to ONE fakeredis instance BEFORE importing any
lane module, so every module's `from shared.redis_client import get_client` binding
captures the same fake regardless of test order. Each test gets a flushed DB.
"""
import os

import fakeredis
import pytest

os.environ.setdefault("DISCOVERY_TOP_N", "5")

import shared.redis_client as rc

FAKE = fakeredis.FakeStrictRedis(decode_responses=True)
rc.get_client = lambda decode=True: FAKE

# Import lane modules now so their imported get_client binds to FAKE.
import engine.pipeline  # noqa: E402,F401
import discovery_orchestrator.orchestrator  # noqa: E402,F401
import discovery_orchestrator.discovery  # noqa: E402,F401
import performance.collector  # noqa: E402,F401
import performance.learn  # noqa: E402,F401
import performance.optimize  # noqa: E402,F401
import performance.insights  # noqa: E402,F401


@pytest.fixture(autouse=True)
def _clean_db():
    FAKE.flushdb()
    yield
    FAKE.flushdb()


@pytest.fixture(autouse=True)
def _offline_engine_side_effects(monkeypatch):
    """Keep the engine's clip-writing path offline & fast.

    ``_write_results_and_finish`` now generates a per-clip title (OpenAI) and burns it onto
    the video (network fetch + ffmpeg). Stub both with deterministic doubles so the suite
    stays hermetic — a real ``.env`` OPENAI_API_KEY must never make tests hit the network.
    A test that wants the real behavior can override these in its own body.
    """
    import engine.overlay as _overlay
    import engine.titles as _titles

    monkeypatch.setattr(
        _titles,
        "generate_title",
        lambda **kw: ((kw.get("hook") or kw.get("topic") or "Clip").strip()[:100] or "Clip"),
    )
    # Return None -> caller keeps the OpenShorts clip_url (no titled file written).
    monkeypatch.setattr(_overlay, "burn_title", lambda *a, **k: None)
    yield
