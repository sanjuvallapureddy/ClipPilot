"""Lane B — A/B variant generation.

For upcoming/winning topics, generate N variant configs (title/caption/hook/thumbnail)
with OpenAI -> patterns:variants:{topic} for A/B testing by Lane C/A. Template fallback
with no key.
"""
from __future__ import annotations

import json
import os

from shared import keys
from shared.redis_client import coord, get_client
from shared.schemas import Patterns, Variant, VariantSet


def _template_variants(topic: str, n: int) -> list[Variant]:
    frames = [
        ("The truth about {t} nobody tells you", "Wait til the end 🤯 #{tag}"),
        ("{t} just changed everything", "This take is wild 🔥 #{tag}"),
        ("Why everyone is wrong about {t}", "Controversial but true 👀 #{tag}"),
        ("I was wrong about {t}", "Changed my mind completely #{tag}"),
    ]
    tag = topic.split()[0].lower()
    out = []
    for i in range(n):
        hook, cap = frames[i % len(frames)]
        out.append(Variant(
            variant_id=f"v{i+1}",
            title=hook.format(t=topic),
            caption=cap.format(tag=tag),
            hook=hook.format(t=topic),
            thumbnail_prompt=f"bold text '{topic}', shocked face, high contrast, vertical",
        ))
    return out


def _gpt_variants(topic: str, n: int, patterns: Patterns) -> list[Variant]:  # pragma: no cover
    from openai import OpenAI

    prompt = (
        f"Generate {n} A/B variants for a short-form podcast clip about '{topic}'. "
        f"Winning style so far: {patterns.summary}. Hooks that work: {patterns.hook_templates}. "
        'Return JSON {"variants":[{"title","caption","hook","thumbnail_prompt"}]}. '
        "Make them distinct (different angles: controversy, curiosity, contrarian)."
    )
    client = OpenAI()
    resp = client.chat.completions.create(
        model=os.getenv("OPENAI_MODEL", "gpt-5.5"),
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},  # gpt-5.x: only default temperature (1)
    )
    data = json.loads(resp.choices[0].message.content).get("variants", [])
    return [
        Variant(variant_id=f"v{i+1}", title=v.get("title", ""), caption=v.get("caption", ""),
                hook=v.get("hook", ""), thumbnail_prompt=v.get("thumbnail_prompt", ""))
        for i, v in enumerate(data[:n])
    ]


def generate_variants(topics: list[str] | None = None, n: int = 3) -> int:
    """Write patterns:variants:{topic} for each winning topic. Returns topics processed."""
    r = get_client()
    patterns = Patterns.from_json(r.get(keys.PATTERNS_CURRENT))
    topics = topics or patterns.winning_topics or ["ai agents and autonomous software"]
    count = 0
    for topic in topics:
        variants = _template_variants(topic, n)
        if os.getenv("OPENAI_API_KEY"):
            try:
                variants = _gpt_variants(topic, n, patterns)
            except Exception as e:
                coord("B", "error", f"gpt variants fallback for {topic}: {e}")
        vs = VariantSet(topic=topic, variants=variants)
        r.set(keys.variants_key(topic), vs.to_json())
        count += 1
    coord("B", "milestone", f"generated {n} variants each for {count} topics")
    return count
