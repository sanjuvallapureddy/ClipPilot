"""Lane B — the self-learning loop (comparator + auto-implementer).

This is what makes ClipPilot self-improve. Every cycle it:
  1. RANKS posted clips by the best REAL signal available — real `views` once clips
     are actually posted, otherwise the real GPT predicted-virality score
     (`engagement_score`) from the real transcript. It NEVER invents a view count;
     the `signal_source` field records which honest signal was used.
  2. COMPARES the top performer against the bottom one head-to-head (GPT, with a
     heuristic fallback when there is no key) and explains WHY the winner won, with
     concrete recommendations.
  3. AUTO-IMPLEMENTS those learnings by writing them straight into `patterns:current`
     (winning topic, hook style, first-line strategy, avoid-topics, ideal length).
     Lane A's `build_config` already feeds `patterns:current` into the EngineConfig,
     and Lane C now honors those fields — so the insight changes the very next batch.
  4. PERSISTS the insight to `insights:latest` (JSON) + `insights:stream` (audit log)
     so the dashboard can show exactly what the AI learned and applied.
"""
from __future__ import annotations

import json
import os
import time
import uuid

from shared import keys
from shared.redis_client import coord, get_client
from shared.schemas import ClipResult, LearningInsight, Patterns

from .learn import _load_results


# --- signal selection (REAL only) --------------------------------------------

def _signal_value(clip: ClipResult, signal_source: str) -> float:
    """The honest performance number for a clip under the chosen signal."""
    if signal_source == "real_views":
        return float(clip.views)
    return float(clip.engagement_score)


def _rank(results: list[ClipResult]) -> tuple[list[ClipResult], str]:
    """Rank clips by the best REAL signal available.

    Prefers real posted views (>=2 clips actually posted with views), otherwise the
    real GPT predicted-virality score. Returns (ranked_desc, signal_source).
    """
    posted = [c for c in results if c.post_status == "posted" and c.views > 0]
    if len(posted) >= 2:
        ranked = sorted(posted, key=lambda c: (c.views, c.watch_time), reverse=True)
        return ranked, "real_views"
    scored = [c for c in results if c.engagement_score > 0]
    ranked = sorted(scored, key=lambda c: c.engagement_score, reverse=True)
    return ranked, "predicted_virality"


def _fmt_signal(value: float, signal_source: str) -> str:
    if signal_source == "real_views":
        return f"{int(value):,} views"
    return f"{value:.2f} predicted virality"


def _infer_hook_style(hook: str) -> str:
    """Cheap, deterministic hook-style classifier for the no-key heuristic path."""
    h = (hook or "").lower()
    if not h:
        return "direct bold-claim"
    if "?" in hook:
        return "curiosity-gap question"
    if any(w in h for w in ("wrong", "myth", "nobody", "the truth", "lie", "actually")):
        return "contrarian myth-buster"
    if any(w in h for w in ("never", "always", "everyone", "no one", "everything")):
        return "bold absolute claim"
    if any(w in h for w in ("how", "why", "secret", "reason")):
        return "open-loop reveal"
    return "direct bold-claim"


# --- comparison (GPT with honest heuristic fallback) -------------------------

def _heuristic_compare(
    winner: ClipResult, loser: ClipResult, signal_source: str,
    winner_signal: float, loser_signal: float,
) -> dict:
    """Plain-language head-to-head from the real attribute deltas. No fabrication."""
    factors: list[str] = []
    reasons: list[str] = []
    recs: list[str] = []

    if winner.length_seconds and loser.length_seconds:
        delta = round(loser.length_seconds - winner.length_seconds)
        if delta >= 3:
            factors.append("tighter length")
            reasons.append(f"It was {delta}s shorter, holding attention better.")
            recs.append(f"Target ~{round(winner.length_seconds)}s; trim setup and dead air.")
        elif delta <= -3:
            factors.append("more developed moment")
            reasons.append(f"It ran {abs(delta)}s longer, letting the tension build.")
            recs.append(f"Allow ~{round(winner.length_seconds)}s when a moment escalates.")

    if winner.topic and winner.topic.lower() != (loser.topic or "").lower():
        factors.append(f"topic '{winner.topic}'")
        reasons.append(f"The topic '{winner.topic}' beat '{loser.topic or 'n/a'}'.")
        recs.append(f"Favor '{winner.topic}' over '{loser.topic or 'weaker topics'}'.")

    hook_style = _infer_hook_style(winner.hook)
    if winner.hook:
        factors.append(f"hook style ({hook_style})")
        reasons.append(f"Its {hook_style} hook was stronger.")
        recs.append(f"Lead with {hook_style} hooks, e.g. \"{winner.hook}\".")

    first_line_strategy = (
        "Open on the single punchiest line in the first 2 seconds, before any context."
    )
    recs.append(first_line_strategy)

    lo = hi = None
    if winner.length_seconds:
        lo = max(10.0, round(winner.length_seconds - 7, 1))
        hi = round(winner.length_seconds + 7, 1)

    ratio = (winner_signal / loser_signal) if loser_signal > 0 else 2.0
    confidence = round(min(0.92, 0.55 + 0.12 * (ratio - 1)), 2)

    why = (
        f"The winner reached {_fmt_signal(winner_signal, signal_source)} vs "
        f"{_fmt_signal(loser_signal, signal_source)} for the loser. "
        + (" ".join(reasons) or "It scored higher on the same virality criteria.")
    )
    return {
        "why": why,
        "factors": factors or ["overall virality"],
        "recommendations": recs,
        "hook_style": hook_style,
        "first_line_strategy": first_line_strategy,
        "ideal_length_min": lo,
        "ideal_length_max": hi,
        "confidence": confidence,
    }


def _gpt_compare(
    winner: ClipResult, loser: ClipResult, signal_source: str,
    winner_signal: float, loser_signal: float, heuristic: dict,
) -> dict:  # pragma: no cover - needs a real key
    from openai import OpenAI

    def row(c: ClipResult, signal: float) -> dict:
        return {
            "signal": signal, "topic": c.topic, "hook": c.hook,
            "quote": (c.quote or "")[:200], "length_seconds": c.length_seconds,
            "reason": c.reason,
        }

    signal_doc = (
        "real_views = actual posted view count"
        if signal_source == "real_views"
        else "predicted_virality = GPT virality score (0-1) from the real transcript"
    )
    prompt = (
        "You are the learning brain of an autonomous short-form clip factory. One clip "
        "(WINNER) outperformed another (LOSER). Explain SPECIFICALLY why, comparing them "
        "head-to-head, then say how to replicate it on future clips.\n"
        f"Performance signal: {signal_source} ({signal_doc}). Higher is better.\n"
        f"WINNER: {json.dumps(row(winner, winner_signal))}\n"
        f"LOSER: {json.dumps(row(loser, loser_signal))}\n"
        "Return JSON with keys: why (2-3 sentences, comparative and concrete), "
        "factors (list[str]: the dimensions that drove the win — hook style, length, "
        "topic, pacing, first line, emotional intensity), recommendations (list[str]: "
        "concrete changes for future clips), hook_style (short label), "
        "first_line_strategy (str), ideal_length_min (number sec), ideal_length_max "
        "(number sec), confidence (0-1)."
    )
    client = OpenAI()
    resp = client.chat.completions.create(
        model=os.getenv("OPENAI_MODEL", "gpt-5.5"),
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"}, temperature=0.4,
    )
    d = json.loads(resp.choices[0].message.content)
    return {
        "why": d.get("why") or heuristic["why"],
        "factors": d.get("factors") or heuristic["factors"],
        "recommendations": d.get("recommendations") or heuristic["recommendations"],
        "hook_style": d.get("hook_style") or heuristic["hook_style"],
        "first_line_strategy": d.get("first_line_strategy") or heuristic["first_line_strategy"],
        "ideal_length_min": d.get("ideal_length_min") or heuristic["ideal_length_min"],
        "ideal_length_max": d.get("ideal_length_max") or heuristic["ideal_length_max"],
        "confidence": float(d.get("confidence", heuristic["confidence"])),
    }


def compare(
    winner: ClipResult, loser: ClipResult, signal_source: str,
    winner_signal: float, loser_signal: float,
) -> dict:
    """Head-to-head explanation. GPT if a key is present, else honest heuristic."""
    heuristic = _heuristic_compare(winner, loser, signal_source, winner_signal, loser_signal)
    if os.getenv("OPENAI_API_KEY"):
        try:
            return _gpt_compare(
                winner, loser, signal_source, winner_signal, loser_signal, heuristic
            )
        except Exception as e:
            coord("B", "error", f"gpt compare fallback: {e}")
    return heuristic


# --- auto-implementation ------------------------------------------------------

def apply_recommendations(
    insight: LearningInsight, patterns: Patterns, winner: ClipResult,
    loser: ClipResult, hints: dict,
) -> Patterns:
    """Write the winner's edge straight into patterns:current. This is the AI
    "implementing it itself" — the changes feed Lane A's next EngineConfig."""
    applied: list[str] = []

    if winner.topic:
        rest = [t for t in patterns.winning_topics if t.lower() != winner.topic.lower()]
        patterns.winning_topics = [winner.topic] + rest
        applied.append(f"promoted topic '{winner.topic}' to top")

    if loser.topic and loser.topic.lower() != (winner.topic or "").lower():
        if loser.topic not in patterns.avoid_topics:
            patterns.avoid_topics = (patterns.avoid_topics + [loser.topic])[-5:]
            applied.append(f"deprioritized topic '{loser.topic}'")

    hook_style = hints.get("hook_style") or _infer_hook_style(winner.hook)
    if hook_style:
        patterns.hook_style = hook_style
        applied.append(f"set hook_style='{hook_style}'")

    if winner.hook:
        rest_h = [h for h in patterns.hook_templates if h != winner.hook]
        patterns.hook_templates = [winner.hook] + rest_h[:4]

    fls = hints.get("first_line_strategy")
    if fls:
        patterns.first_line_strategy = fls
        applied.append("updated first_line_strategy")

    lo = hints.get("ideal_length_min")
    hi = hints.get("ideal_length_max")
    if (not lo or not hi) and winner.length_seconds:
        lo = max(10.0, winner.length_seconds - 7)
        hi = winner.length_seconds + 7
    if lo and hi:
        lo = round(float(lo), 1)
        hi = max(round(float(hi), 1), lo + 5)
        patterns.ideal_length_min, patterns.ideal_length_max = lo, hi
        applied.append(f"tightened ideal length to {lo}-{hi}s")

    patterns.insight_summary = insight.why
    insight.applied = applied
    return patterns


# --- entrypoint ---------------------------------------------------------------

def run_insight() -> LearningInsight | None:
    """One self-learning pass: rank -> compare top vs bottom -> apply -> persist."""
    r = get_client()
    results = _load_results(r)
    ranked, signal_source = _rank(results)
    if len(ranked) < 2:
        coord("B", "info",
              "self-learning: need >=2 comparable clips with a real signal; skipping")
        return None

    winner, loser = ranked[0], ranked[-1]
    if winner.clip_id == loser.clip_id:
        return None

    winner_signal = _signal_value(winner, signal_source)
    loser_signal = _signal_value(loser, signal_source)
    comp = compare(winner, loser, signal_source, winner_signal, loser_signal)

    insight = LearningInsight(
        insight_id=uuid.uuid4().hex[:10],
        winner_clip_id=winner.clip_id,
        loser_clip_id=loser.clip_id,
        signal_source=signal_source,
        winner_signal=round(winner_signal, 4),
        loser_signal=round(loser_signal, 4),
        why=comp["why"],
        factors=comp["factors"],
        recommendations=comp["recommendations"],
        confidence=float(comp["confidence"]),
    )

    # auto-implement into the patterns that drive the next batch
    patterns = Patterns.from_json(r.get(keys.PATTERNS_CURRENT))
    apply_recommendations(insight, patterns, winner, loser, comp)
    patterns.updated_at = time.time()
    r.set(keys.PATTERNS_CURRENT, patterns.to_json())

    # persist for the dashboard + audit trail
    r.set(keys.INSIGHTS_LATEST, insight.to_json())
    try:
        r.xadd(keys.INSIGHTS_STREAM, insight.to_redis(), maxlen=500, approximate=True)
    except Exception as e:  # pragma: no cover
        coord("B", "error", f"insights stream write failed: {e}")

    coord("B", "milestone",
          f"self-learning [{signal_source}]: winner {winner.clip_id} "
          f"({_fmt_signal(winner_signal, signal_source)}) beat {loser.clip_id} "
          f"({_fmt_signal(loser_signal, signal_source)}); applied {insight.applied}")
    return insight
