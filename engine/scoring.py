"""Podcast-tuned viral-scoring criteria (Lane C).

The actual scoring call lives in `pipeline._detect_moments` (one GPT pass over the real
transcript windows). This module holds the shared factor list + prompt criteria so they
stay in one place and can be handed to OpenShorts' scorer in a future REAL render path.
No synthetic scoring here.
"""
from __future__ import annotations

FACTORS = ["humor", "controversy", "insight", "emotional_intensity", "trend_relevance"]

# Weighting guidance applied in the moment-detection prompt: controversy + emotional
# intensity dominate short-form virality, then humor, then a surprising insight.
PODCAST_SCORING_PROMPT = (
    "Score podcast moments for short-form virality. Weight controversy and emotional "
    "intensity highest, then humor, then surprising insight, then trend relevance. Prefer "
    "self-contained 18-45s moments with a strong opening line."
)
