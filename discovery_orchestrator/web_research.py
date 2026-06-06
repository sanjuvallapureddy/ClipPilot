"""Lane A — browser-use web research (REAL data only).

This module is the Lane-A-side bridge to the browser-use research harness. It runs
INSIDE Lane A's `.venv` and therefore MUST NOT import ``browser_use`` (that would drag
in openai>=2 / starlette>=1 and break the FastAPI lanes). Instead it shells out to
``harness_runner.py`` using the isolated ``.venv-harness`` interpreter and parses its
stdout.

Flow:
    1. Run the browser-use agent (subprocess) to get trending "leads" for a topic.
    2. Resolve each lead to REAL YouTube videos by REUSING ``discovery.fetch_candidates``
       (real titles/channels/URLs/view counts via the YouTube Data API or yt-dlp).
    3. Score with ``discovery.score_virality`` and build ``DiscoveryItem``s exactly like
       ``discovery.discover`` (same construction + ``index_topic`` call), dedupe via
       ``seen:{video_id}``, and push the top-N onto ``discovery:queue``.
    4. If the harness produces no usable leads, fall back to ``discovery.discover`` so
       ``/research`` still returns real results.

This reuses the existing contract keys (``discovery:queue`` + ``DiscoveryItem``); it is
NOT a contract change. Real data only — nothing here is mocked or simulated.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path

from shared import keys
from shared.redis_client import coord, get_client
from shared.schemas import DiscoveryItem, Patterns

from . import discovery

# Repo root = parent of the discovery_orchestrator package dir.
_REPO_ROOT = Path(__file__).resolve().parent.parent
_RUNNER = Path(__file__).resolve().parent / "harness_runner.py"
HARNESS_PYTHON = os.getenv(
    "HARNESS_PYTHON", str(_REPO_ROOT / ".venv-harness" / "bin" / "python")
)


def _parse_leads(stdout: str) -> list[dict]:
    """Parse the lead JSON array from harness stdout, robust to extra log lines.

    Strategy: take the LAST parseable JSON array printed (the runner emits exactly one,
    but agent/runtime noise may precede it). On any failure, return []."""
    if not stdout:
        return []
    text = stdout.strip()
    try:
        val = json.loads(text)
        if isinstance(val, list):
            return [x for x in val if isinstance(x, dict)]
    except Exception:
        pass
    for chunk in reversed(re.findall(r"\[.*?\]", text, re.DOTALL)):
        try:
            val = json.loads(chunk)
            if isinstance(val, list):
                return [x for x in val if isinstance(x, dict)]
        except Exception:
            continue
    return []


def _run_harness(topic: str) -> list[dict]:
    """Invoke the isolated browser-use harness as a subprocess and parse leads."""
    if not Path(HARNESS_PYTHON).exists():
        coord("A", "error",
              f"research harness python not found at {HARNESS_PYTHON} (create .venv-harness)")
        return []
    timeout = int(os.getenv("HARNESS_TIMEOUT_SECONDS", "240"))
    try:
        proc = subprocess.run(
            [HARNESS_PYTHON, str(_RUNNER), topic],
            capture_output=True, text=True, timeout=timeout,
            cwd=str(_REPO_ROOT),
        )
    except subprocess.TimeoutExpired:
        coord("A", "error", f"research harness timed out after {timeout}s for '{topic}'")
        return []
    except Exception as e:
        coord("A", "error", f"research harness failed to launch: {e}")
        return []
    leads = _parse_leads(proc.stdout)
    if not leads and proc.stderr.strip():
        # surface the harness's own reason (e.g. missing key) without faking anything
        coord("A", "info", f"research harness returned no leads: {proc.stderr.strip()[:200]}")
    return leads


def _resolve_candidates(leads: list[dict], topic: str) -> list[dict]:
    """Resolve leads -> REAL YouTube candidates via discovery.fetch_candidates.

    Aggregates across leads, deduped by video_id (first occurrence wins)."""
    per_lead = int(os.getenv("RESEARCH_PER_LEAD", "6"))
    max_leads = int(os.getenv("RESEARCH_MAX_LEADS", "6"))
    by_vid: dict[str, dict] = {}
    for lead in leads[:max_leads]:
        query = (lead.get("title") or lead.get("topic") or topic).strip()
        if not query:
            continue
        for c in discovery.fetch_candidates(query, max_results=per_lead):
            vid = c.get("video_id")
            if vid and vid not in by_vid:
                by_vid[vid] = c
    return list(by_vid.values())


def research(topic: str, top_n: int | None = None) -> list[DiscoveryItem]:
    """Run one browser-use-guided research pass and push top-N REAL episodes.

    Returns the list of DiscoveryItems pushed to ``discovery:queue``. Falls back to
    ``discovery.discover`` when the harness yields no usable leads."""
    top_n = top_n or int(os.getenv("DISCOVERY_TOP_N", "5"))
    r = get_client()
    patterns = Patterns.from_json(r.get(keys.PATTERNS_CURRENT))

    leads = _run_harness(topic)
    if not leads:
        coord("A", "info",
              f"research: no harness leads for '{topic}' -> falling back to discovery")
        return discovery.discover(topic=topic, top_n=top_n, patterns=patterns)

    coord("A", "info", f"research: harness returned {len(leads)} leads for '{topic}'")
    candidates = _resolve_candidates(leads, topic)
    if not candidates:
        coord("A", "info",
              "research: leads resolved to 0 real YouTube candidates -> falling back")
        return discovery.discover(topic=topic, top_n=top_n, patterns=patterns)

    # Score + build items exactly like discovery.discover does.
    scored: list[tuple[str, DiscoveryItem]] = []  # (video_id, item)
    for c in candidates:
        topic_summary = c["title"]
        fit = discovery.trend_fit(topic_summary)
        ts, _reason = discovery.score_virality(
            c["title"], topic_summary, c["view_count"], fit, patterns
        )
        discovery.index_topic(c["video_id"], topic_summary)  # grow the real trend space
        scored.append((c["video_id"], DiscoveryItem(
            youtube_url=c["youtube_url"], title=c["title"], podcast=c["podcast"],
            topic=topic_summary, published_at=c["published_at"],
            trend_score=ts, source="youtube",
        )))

    scored.sort(key=lambda pair: pair[1].trend_score, reverse=True)

    # Dedupe via seen:{video_id} and push the top-N newly-seen items.
    pushed: list[DiscoveryItem] = []
    for vid, item in scored:
        if len(pushed) >= top_n:
            break
        if not r.set(keys.seen_key(vid), "1", nx=True, ex=keys.SEEN_TTL_SECONDS):
            continue  # already researched/seen recently — don't re-queue
        r.xadd(keys.DISCOVERY_QUEUE, item.to_redis(), maxlen=500, approximate=True)
        pushed.append(item)

    if not pushed:
        coord("A", "info",
              "research: all candidates already seen -> falling back to discovery")
        return discovery.discover(topic=topic, top_n=top_n, patterns=patterns)

    coord("A", "milestone",
          f"web-research pushed {len(pushed)}/{len(scored)} REAL episodes for "
          f"'{topic}' -> discovery:queue")
    return pushed
