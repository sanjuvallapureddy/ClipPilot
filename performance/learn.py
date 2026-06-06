"""Lane B — learning.

Read all results:{clip_id}, have GPT summarize what's winning (topics, hook styles, clip
lengths, caption patterns) into structured `patterns:current`. Heuristic fallback (no
key) computes winners by aggregate engagement so the loop still learns offline.
"""
from __future__ import annotations

import json
import os
from collections import defaultdict

from shared import keys
from shared.redis_client import coord, get_client
from shared.schemas import ClipResult, Patterns


def _load_results(r) -> list[ClipResult]:
    out = []
    for clip_id in r.smembers(keys.RESULTS_SET):
        d = r.hgetall(keys.result_key(clip_id))
        if d:
            out.append(ClipResult.from_redis(d))
    return out


def _heuristic_patterns(results: list[ClipResult]) -> Patterns:
    by_topic: dict[str, list[float]] = defaultdict(list)
    by_hook: dict[str, list[float]] = defaultdict(list)
    lengths: list[float] = []
    for c in results:
        if c.topic:
            by_topic[c.topic].append(c.engagement_score)
        if c.hook:
            by_hook[c.hook].append(c.engagement_score)
        if c.length_seconds:
            lengths.append(c.length_seconds)

    def _avg(xs):
        return sum(xs) / len(xs) if xs else 0.0

    top_topics = sorted(by_topic, key=lambda t: _avg(by_topic[t]), reverse=True)[:3]
    top_hooks = sorted(by_hook, key=lambda h: _avg(by_hook[h]), reverse=True)[:3]

    # ideal length = range around the top-quartile performers
    winners = sorted(results, key=lambda c: c.engagement_score, reverse=True)
    top_q = winners[: max(1, len(winners) // 4)]
    wl = [c.length_seconds for c in top_q if c.length_seconds] or [25.0, 40.0]
    return Patterns(
        winning_topics=top_topics or ["ai agents and autonomous software"],
        hook_templates=top_hooks or ["The truth about {topic} nobody tells you"],
        ideal_length_min=round(min(wl), 1),
        ideal_length_max=round(max(wl), 1),
        caption_style="bold-keyword-highlight",
        summary=(f"Top topics by engagement: {', '.join(top_topics)}. "
                 f"Best length {round(min(wl),1)}-{round(max(wl),1)}s."),
    )


def _gpt_patterns(results: list[ClipResult], heuristic: Patterns) -> Patterns:  # pragma: no cover
    from openai import OpenAI

    rows = [
        {"topic": c.topic, "hook": c.hook, "len": c.length_seconds,
         "views": c.views, "engagement": c.engagement_score, "platform": c.platform}
        for c in sorted(results, key=lambda x: x.engagement_score, reverse=True)[:40]
    ]
    prompt = (
        "You analyze short-form podcast clip performance. Given these results, identify "
        "what wins. Return JSON with keys: winning_topics (list[str], best first), "
        "hook_templates (list[str], use {topic}/{guest} placeholders), ideal_length_min "
        "(number sec), ideal_length_max (number sec), caption_style (str), summary (str).\n"
        f"RESULTS:\n{json.dumps(rows)}"
    )
    client = OpenAI()
    resp = client.chat.completions.create(
        model=os.getenv("OPENAI_MODEL", "gpt-5.5"),
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},  # gpt-5.x: only default temperature (1)
    )
    d = json.loads(resp.choices[0].message.content)
    return Patterns(
        winning_topics=d.get("winning_topics") or heuristic.winning_topics,
        hook_templates=d.get("hook_templates") or heuristic.hook_templates,
        ideal_length_min=float(d.get("ideal_length_min", heuristic.ideal_length_min)),
        ideal_length_max=float(d.get("ideal_length_max", heuristic.ideal_length_max)),
        caption_style=d.get("caption_style", heuristic.caption_style),
        summary=d.get("summary", heuristic.summary),
    )


def learn() -> Patterns:
    """Compute patterns:current from current results. GPT if key present, else heuristic."""
    r = get_client()
    results = _load_results(r)
    if not results:
        coord("B", "info", "no results yet; keeping existing patterns")
        return Patterns.from_json(r.get(keys.PATTERNS_CURRENT))

    patterns = _heuristic_patterns(results)
    if os.getenv("OPENAI_API_KEY"):
        try:
            patterns = _gpt_patterns(results, patterns)
        except Exception as e:
            coord("B", "error", f"gpt learn fallback: {e}")

    r.set(keys.PATTERNS_CURRENT, patterns.to_json())
    coord("B", "milestone",
          f"updated patterns:current -> topics={patterns.winning_topics} "
          f"len={patterns.ideal_length_min}-{patterns.ideal_length_max}s")
    return patterns
