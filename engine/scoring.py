"""Podcast-tuned viral-moment scoring (Lane C).

OpenShorts already detects viral moments; here we expose a *podcast-tuned* scoring
prompt over our factors (humor, controversy, insight, emotional intensity, trend
relevance) with a provider switch (OpenAI | Gemini). In REAL mode this prompt is
handed to OpenShorts' scorer; in MOCK mode we score deterministically so the demo
works without keys.

We do NOT reimplement transcription/cutting — only the scoring *prompt/criteria*.
"""
from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass

FACTORS = ["humor", "controversy", "insight", "emotional_intensity", "trend_relevance"]

PODCAST_SCORING_PROMPT = """You are a viral short-form editor scoring PODCAST moments.
Given a transcript segment, rate 0-1 on each factor and return JSON:
{{"humor":..,"controversy":..,"insight":..,"emotional_intensity":..,"trend_relevance":..,
  "overall":.., "hook":"<punchy 1-line hook>", "reason":"<why it pops>"}}

Weight for short-form virality: controversy and emotional_intensity matter most, then
humor, then a surprising insight. trend_relevance boosts moments tied to: {trends}.
Prefer self-contained 18-45s moments with a strong opening line. Segment:
---
{segment}
---"""


@dataclass
class MomentScore:
    overall: float
    factors: dict[str, float]
    hook: str
    reason: str


def _deterministic_score(segment: str, trends: list[str]) -> MomentScore:
    """Stable pseudo-score from a hash so MOCK runs are reproducible."""
    h = int(hashlib.sha256(segment.encode()).hexdigest(), 16)
    factors = {}
    for i, f in enumerate(FACTORS):
        factors[f] = round(((h >> (i * 8)) & 0xFF) / 255.0, 3)
    # weight per the prompt
    w = {"controversy": 0.3, "emotional_intensity": 0.25, "humor": 0.2,
         "insight": 0.15, "trend_relevance": 0.1}
    overall = round(sum(factors[f] * w[f] for f in FACTORS), 3)
    if any(t.lower() in segment.lower() for t in trends):
        overall = min(1.0, overall + 0.1)
    return MomentScore(
        overall=overall,
        factors=factors,
        hook=f"The most controversial take on {(trends or ['this'])[0]}",
        reason="High controversy + emotional intensity, self-contained.",
    )


def score_segment(segment: str, trends: list[str] | None = None,
                  provider: str | None = None) -> MomentScore:
    trends = trends or []
    provider = provider or os.getenv("ENGINE_SCORING_PROVIDER", "openai")

    if os.getenv("ENGINE_MODE", "MOCK").upper() == "MOCK":
        return _deterministic_score(segment, trends)

    prompt = PODCAST_SCORING_PROMPT.format(trends=", ".join(trends) or "none", segment=segment)
    try:
        if provider == "gemini":
            return _score_gemini(prompt)
        return _score_openai(prompt)
    except Exception as e:  # pragma: no cover - fall back gracefully
        print(f"[engine.scoring] {provider} failed ({e}); deterministic fallback")
        return _deterministic_score(segment, trends)


def _parse(d: dict) -> MomentScore:
    factors = {f: float(d.get(f, 0.0)) for f in FACTORS}
    return MomentScore(
        overall=float(d.get("overall", sum(factors.values()) / len(factors))),
        factors=factors,
        hook=str(d.get("hook", "")),
        reason=str(d.get("reason", "")),
    )


def _score_openai(prompt: str) -> MomentScore:
    import json

    from openai import OpenAI

    client = OpenAI()
    resp = client.chat.completions.create(
        model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.4,
    )
    return _parse(json.loads(resp.choices[0].message.content))


def _score_gemini(prompt: str) -> MomentScore:  # pragma: no cover - optional path
    import json

    import google.generativeai as genai

    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    model = genai.GenerativeModel("gemini-1.5-flash")
    resp = model.generate_content(prompt + "\nReturn ONLY JSON.")
    text = resp.text.strip().lstrip("```json").rstrip("```").strip()
    return _parse(json.loads(text))
