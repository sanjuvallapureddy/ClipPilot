"""Shared offline test fixtures.

Patches the single Redis connection point to ONE fakeredis instance BEFORE importing any
lane module, so every module's `from shared.redis_client import get_client` binding
captures the same fake regardless of test order. Each test gets a flushed DB.
"""
import os

import fakeredis
import pytest

os.environ.setdefault("ENGINE_MODE", "MOCK")
os.environ.setdefault("PERFORMANCE_SIMULATE", "1")
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


@pytest.fixture(autouse=True)
def _clean_db():
    FAKE.flushdb()
    yield
    FAKE.flushdb()
