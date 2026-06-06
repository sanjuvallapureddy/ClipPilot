"""Shared Redis helpers used by all Python lanes (A, B, C).

Centralizes the connection, the RediSearch vector index for `idx:trends`,
coord-log posting, and a few convenience read/write helpers built on the
contract in `keys.py`. Lanes import from here so the contract stays in one place.
"""
from __future__ import annotations

import os
from typing import Any, Iterable

import redis

from . import keys
from .schemas import CoordMessage, Job, JobEvent

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")


def get_client(decode: bool = True) -> redis.Redis:
    return redis.Redis.from_url(REDIS_URL, decode_responses=decode)


# --- RediSearch vector index for trends ---------------------------------------

def ensure_trends_index(r: redis.Redis | None = None) -> None:
    """Create the `idx:trends` HNSW COSINE vector index if missing.

    Requires redis-stack (RediSearch). Safe to call repeatedly.
    """
    r = r or get_client()
    try:
        from redis.commands.search.field import TextField, VectorField
        from redis.commands.search.indexDefinition import IndexDefinition, IndexType
    except Exception as e:  # pragma: no cover - redis-stack not present
        print(f"[shared] RediSearch unavailable, skipping index: {e}")
        return

    try:
        r.ft(keys.TRENDS_INDEX).info()
        return  # already exists
    except Exception:
        pass

    schema = (
        TextField("$.topic", as_name="topic"),
        TextField("$.source", as_name="source"),
        VectorField(
            "$.vector",
            "HNSW",
            {
                "TYPE": "FLOAT32",
                "DIM": keys.TREND_VECTOR_DIM,
                "DISTANCE_METRIC": "COSINE",
            },
            as_name="vector",
        ),
    )
    definition = IndexDefinition(prefix=[keys.TREND_PREFIX], index_type=IndexType.JSON)
    try:
        r.ft(keys.TRENDS_INDEX).create_index(schema, definition=definition)
        print(f"[shared] created vector index {keys.TRENDS_INDEX}")
    except Exception as e:  # pragma: no cover
        print(f"[shared] could not create index: {e}")


# --- Coordination -------------------------------------------------------------

def coord(lane: str, kind: str, message: str, r: redis.Redis | None = None) -> None:
    r = r or get_client()
    msg = CoordMessage(lane=lane, kind=kind, message=message)
    try:
        r.xadd(keys.COORD_LOG, msg.to_redis(), maxlen=1000, approximate=True)
    except Exception as e:  # pragma: no cover
        print(f"[shared] coord log failed: {e}")
    print(f"[coord:{lane}/{kind}] {message}")


# --- Jobs ---------------------------------------------------------------------

def write_job(job: Job, r: redis.Redis | None = None) -> None:
    r = r or get_client()
    import time

    job.updated_at = time.time()
    r.hset(keys.job_key(job.job_id), mapping=job.to_redis())


def emit_job_event(event: JobEvent, r: redis.Redis | None = None) -> None:
    r = r or get_client()
    r.xadd(keys.JOBS_STREAM, event.to_redis(), maxlen=2000, approximate=True)


def advance_job(
    job: Job, stage: str, message: str = "", status: str = "ok", error: str = "",
    r: redis.Redis | None = None,
) -> Job:
    """Update a job's stage, persist it, and emit a stream event in one shot."""
    r = r or get_client()
    job.stage = stage
    job.status = status
    if error:
        job.error = error
    write_job(job, r)
    emit_job_event(
        JobEvent(job_id=job.job_id, stage=stage, status=status, title=job.title, message=message),
        r,
    )
    return job


def read_job(job_id: str, r: redis.Redis | None = None) -> Job | None:
    r = r or get_client()
    d = r.hgetall(keys.job_key(job_id))
    return Job.from_redis(d) if d else None


def iter_results(r: redis.Redis | None = None) -> Iterable[dict[str, Any]]:
    r = r or get_client()
    for clip_id in r.smembers(keys.RESULTS_SET):
        d = r.hgetall(keys.result_key(clip_id))
        if d:
            yield d
