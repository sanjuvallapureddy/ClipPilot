"""Lane A — Control API (FastAPI + APScheduler).

Endpoints (§5): POST /run-once, POST /start, POST /stop, GET /status. Also exposes
/discover and read endpoints the dashboard bridge uses. The scheduler drives the
autonomous loop on a cadence so it runs unattended.
"""
from __future__ import annotations

import os
import threading
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from shared import keys
from shared.redis_client import coord, get_client
from shared.schemas import DiscoveryItem, Patterns

from . import discovery, orchestrator, web_research

app = FastAPI(title="ClipPilot Discovery + Orchestrator", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"],
                   allow_headers=["*"])

_scheduler = BackgroundScheduler()
_lock = threading.Lock()
INTERVAL = int(os.getenv("ORCHESTRATOR_INTERVAL_SECONDS", "120"))
_state = {"running": False, "topic": "tech", "cycles": 0, "last": None,
          "interval_seconds": INTERVAL}


def _cycle(topic: str | None = None) -> dict:
    with _lock:  # serialize cycles so we never double-process
        result = orchestrator.run_once(topic or _state["topic"])
        _state["cycles"] += 1
        _state["last"] = result
    return result


@app.on_event("startup")
def _startup() -> None:
    if not _scheduler.running:
        _scheduler.start()
    coord("A", "milestone", "discovery-orchestrator up")
    coord("A", "info", "added browser-use research harness (isolated .venv-harness)")


class StartReq(BaseModel):
    topic: str = "tech"
    interval_seconds: int | None = None


class DiscoverReq(BaseModel):
    topic: str = "tech"
    top_n: int | None = None


@app.get("/health")
def health() -> dict:
    return {"ok": True, "running": _state["running"]}


@app.post("/run-once")
def run_once(req: DiscoverReq | None = None) -> dict:
    topic = (req.topic if req else None) or _state["topic"]
    return _cycle(topic)


@app.post("/start")
def start(req: StartReq) -> dict:
    _state["topic"] = req.topic
    interval = max(1, req.interval_seconds or INTERVAL)
    if _scheduler.get_job("loop"):
        _scheduler.remove_job("loop")
    # next_run_time=now: APScheduler's interval trigger otherwise delays the FIRST cycle a
    # whole `interval` out (120s default, up to 60 min with the UI presets) — so "Start Auto"
    # looked broken because nothing happened on launch. Fire one cycle immediately, then every
    # `interval`s. Cycles run on the scheduler's worker thread, so /start still returns instantly
    # instead of blocking on a (potentially long) pipeline run.
    _scheduler.add_job(_cycle, "interval", seconds=interval, id="loop",
                       max_instances=1, coalesce=True, next_run_time=datetime.now())
    _state["running"] = True
    _state["interval_seconds"] = interval
    coord("A", "milestone", f"autonomous loop STARTED topic='{req.topic}' every {interval}s")
    return {"status": "started", "topic": req.topic, "interval_seconds": interval}


@app.post("/stop")
def stop() -> dict:
    if _scheduler.get_job("loop"):
        _scheduler.remove_job("loop")
    _state["running"] = False
    coord("A", "milestone", "autonomous loop STOPPED")
    return {"status": "stopped"}


@app.get("/health")
def health() -> dict:
    """Lightweight liveness probe — no Redis required."""
    return {"ok": True, "service": "discovery-orchestrator"}


@app.get("/status")
def status() -> dict:
    r = get_client()
    try:
        pending = r.xlen(keys.DISCOVERY_QUEUE)
    except Exception:
        pending = 0
    patterns = Patterns.from_json(r.get(keys.PATTERNS_CURRENT))
    return {
        "running": _state["running"],
        "topic": _state["topic"],
        "cycles": _state["cycles"],
        "last": _state["last"],
        "interval_seconds": _state.get("interval_seconds", INTERVAL),
        "queue_pending": pending,
        "current_patterns": patterns.model_dump(),
    }


@app.post("/discover")
def discover(req: DiscoverReq) -> dict:
    patterns = Patterns.from_json(get_client().get(keys.PATTERNS_CURRENT))
    items = discovery.discover(topic=req.topic, top_n=req.top_n, patterns=patterns)
    return {"count": len(items), "items": [i.model_dump() for i in items]}


@app.post("/research")
def research(req: DiscoverReq) -> dict:
    """Browser-use-guided discovery: run the isolated research harness to find trending
    leads, resolve them to REAL YouTube episodes, score, and queue the top-N. Falls back
    to plain discovery when the harness yields nothing. Reuses discovery:queue + the
    DiscoveryItem schema (not a contract change)."""
    items = web_research.research(topic=req.topic, top_n=req.top_n)
    return {"count": len(items), "items": [i.model_dump() for i in items]}


# --- read endpoints for the dashboard bridge ---------------------------------

@app.get("/queue")
def queue(limit: int = 20) -> dict:
    r = get_client()
    entries = r.xrevrange(keys.DISCOVERY_QUEUE, count=limit)
    return {"items": [DiscoveryItem.from_redis(f).model_dump() for _, f in entries]}


@app.get("/jobs")
def jobs(limit: int = 50) -> dict:
    r = get_client()
    out = []
    for key in r.scan_iter(match=f"{keys.JOBS_PREFIX}*", count=200):
        if key == keys.JOBS_STREAM:
            continue
        d = r.hgetall(key)
        if d:
            out.append(d)
    out.sort(key=lambda j: float(j.get("updated_at", 0)), reverse=True)
    return {"jobs": out[:limit]}
