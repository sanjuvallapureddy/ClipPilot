"""Real-state grounding for the chat personas.

Every message a persona writes must be anchored in the REAL contract state (no invented
metrics). These helpers read the contract keys and produce a short factual string the LLM
gets as context. Best-effort: any read failure degrades to a neutral string, never a crash.
"""
from __future__ import annotations

from typing import Any, Callable

import redis

from shared import keys
from shared.redis_client import get_client
from shared.schemas import ClipResult, DiscoveryItem, Patterns


def _safe(fn: Callable[[], Any], default: Any) -> Any:
    try:
        return fn()
    except Exception:
        return default


def snapshot(r: redis.Redis | None = None) -> dict:
    """One read of the shared state the personas reason about."""
    r = r or get_client()

    def _top() -> DiscoveryItem | None:
        rows = r.xrevrange(keys.DISCOVERY_QUEUE, count=1)
        return DiscoveryItem.from_redis(rows[0][1]) if rows else None

    def _best() -> ClipResult | None:
        best: ClipResult | None = None
        for cid in list(r.smembers(keys.RESULTS_SET))[:25]:
            d = r.hgetall(keys.result_key(cid))
            if not d:
                continue
            c = ClipResult.from_redis(d)
            if best is None or c.engagement_score > best.engagement_score:
                best = c
        return best

    raw_patterns = _safe(lambda: r.get(keys.PATTERNS_CURRENT), None)
    return {
        "queue_depth": _safe(lambda: r.xlen(keys.DISCOVERY_QUEUE), 0),
        "top": _safe(_top, None),
        "n_clips": _safe(lambda: r.scard(keys.RESULTS_SET), 0),
        "best_clip": _safe(_best, None),
        "patterns": Patterns.from_json(raw_patterns) if raw_patterns else Patterns(),
        "has_patterns": bool(raw_patterns),
    }


def grounding_for(agent_id: str, snap: dict) -> str:
    """A short, factual context line tailored to what this agent cares about."""
    p: Patterns = snap["patterns"]
    top: DiscoveryItem | None = snap["top"]
    best: ClipResult | None = snap["best_clip"]
    common = (
        f"Queue has {snap['queue_depth']} episode(s) waiting; "
        f"{snap['n_clips']} clip(s) detected so far."
    )
    if agent_id == "scout":
        t = (
            f" Top queued: '{top.title}' (score {top.trend_score})."
            if top
            else " Queue is empty — time to discover."
        )
        wt = (
            f" Winning topics to bias toward: {', '.join(p.winning_topics)}."
            if p.winning_topics
            else ""
        )
        return common + t + wt
    if agent_id == "cutter":
        b = (
            f" Best clip so far: \"{best.hook}\" (score {best.engagement_score})."
            if best
            else " No clips cut yet."
        )
        hk = (
            f" Hooks that work: {', '.join(p.hook_templates[:2])}."
            if p.hook_templates
            else ""
        )
        return common + b + hk
    if agent_id == "coach":
        s = (
            f" Current playbook: {p.summary}"
            if snap["has_patterns"] and p.summary
            else " No patterns learned yet — need more posted clips."
        )
        return common + s
    # pilot
    wt = f" Winning topics: {', '.join(p.winning_topics)}." if p.winning_topics else ""
    return common + wt
