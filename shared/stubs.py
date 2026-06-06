"""Stub data generators for EVERY Redis key (Build Order step 2).

Run `python -m shared.stubs --all` to seed Redis so any lane can run in
isolation with realistic fake data. Each generator is independently callable.
"""
from __future__ import annotations

import argparse
import random
import time
import uuid
from datetime import datetime, timezone

from . import keys
from .redis_client import (
    advance_job,
    coord,
    emit_job_event,
    ensure_trends_index,
    get_client,
    write_job,
)
from .schemas import (
    ClipResult,
    DiscoveryItem,
    Job,
    JobEvent,
    Patterns,
    Variant,
    VariantSet,
)

PODCASTS = [
    ("The All-In Podcast", "tech"),
    ("Lex Fridman Podcast", "ai"),
    ("My First Million", "startups"),
    ("Huberman Lab", "health"),
    ("Acquired", "business"),
    ("The Diary of a CEO", "founders"),
]
TOPICS = ["ai agents", "startup fundraising", "longevity", "crypto regulation",
          "founder burnout", "AGI timelines", "remote work", "venture capital"]
HOOKS = [
    "You won't believe what {guest} said about {topic}...",
    "The truth about {topic} nobody tells you",
    "This {topic} take is wildly controversial",
    "{guest} just changed my mind on {topic}",
]
NEWS_HEADLINES = [
    "OpenAI ships new agent framework",
    "Fed signals rate cut amid AI boom",
    "Anthropic raises mega-round",
    "Longevity startups attract record funding",
    "Crypto regulation bill advances in Senate",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def seed_trends(n: int = 8) -> None:
    """Seed `trend:{id}` JSON hashes + the vector index (random vectors in stub mode)."""
    r = get_client()
    ensure_trends_index(r)
    import json
    for i, topic in enumerate(random.sample(TOPICS + NEWS_HEADLINES, k=min(n, len(TOPICS + NEWS_HEADLINES)))):
        tid = f"stub-{i}"
        vec = [random.uniform(-1, 1) for _ in range(keys.TREND_VECTOR_DIM)]
        doc = {"topic": topic, "source": "seed", "vector": vec}
        try:
            r.json().set(keys.trend_key(tid), "$", doc)
        except Exception:
            # fallback if RedisJSON unavailable: store topic only
            r.hset(keys.trend_key(tid), mapping={"topic": topic, "source": "seed"})
    coord("stub", "milestone", f"seeded {n} trends")


def seed_discovery(n: int = 6) -> None:
    r = get_client()
    for _ in range(n):
        podcast, topic_cat = random.choice(PODCASTS)
        vid = uuid.uuid4().hex[:11]
        item = DiscoveryItem(
            youtube_url=f"https://youtube.com/watch?v={vid}",
            title=f"{podcast}: the future of {random.choice(TOPICS)}",
            podcast=podcast,
            topic=random.choice(TOPICS),
            published_at=_now_iso(),
            trend_score=round(random.uniform(0.55, 0.98), 3),
            source="youtube",
        )
        r.xadd(keys.DISCOVERY_QUEUE, item.to_redis(), maxlen=500, approximate=True)
    coord("stub", "milestone", f"seeded {n} discovery items")


def seed_jobs(n: int = 4) -> None:
    r = get_client()
    stages = ["queued", "submitted", "rendering", "publishing", "done"]
    for _ in range(n):
        jid = uuid.uuid4().hex[:8]
        podcast, _ = random.choice(PODCASTS)
        job = Job(
            job_id=jid,
            episode_url=f"https://youtube.com/watch?v={uuid.uuid4().hex[:11]}",
            title=f"{podcast} clip",
            topic=random.choice(TOPICS),
            stage="queued",
        )
        write_job(job, r)
        # walk it partway through the pipeline to populate jobs:stream
        for st in stages[: random.randint(1, len(stages))]:
            advance_job(job, st, message=f"stub -> {st}", r=r)
            time.sleep(0.01)
    coord("stub", "milestone", f"seeded {n} jobs")


def seed_results(n: int = 12) -> None:
    r = get_client()
    for _ in range(n):
        clip_id = uuid.uuid4().hex[:10]
        topic = random.choice(TOPICS)
        platform = random.choice(keys.PLATFORMS)
        views = random.randint(500, 250_000)
        likes = int(views * random.uniform(0.02, 0.15))
        shares = int(views * random.uniform(0.001, 0.03))
        length = round(random.uniform(18, 50), 1)
        watch = round(length * random.uniform(0.4, 0.95), 1)
        eng = round((likes + 3 * shares) / max(views, 1) + watch / length * 0.3, 4)
        res = ClipResult(
            clip_id=clip_id,
            job_id=uuid.uuid4().hex[:8],
            clip_url=f"https://cdn.clippilot.dev/{clip_id}.mp4",
            platform=platform,
            post_id=uuid.uuid4().hex[:12],
            posted_at=_now_iso(),
            title=f"{topic} hot take",
            topic=topic,
            hook=random.choice(HOOKS),
            length_seconds=length,
            views=views,
            likes=likes,
            shares=shares,
            watch_time=watch,
            engagement_score=eng,
        )
        r.hset(keys.result_key(clip_id), mapping=res.to_redis())
        r.sadd(keys.RESULTS_SET, clip_id)
    coord("stub", "milestone", f"seeded {n} results")


def seed_patterns() -> None:
    r = get_client()
    p = Patterns(
        winning_topics=random.sample(TOPICS, 3),
        hook_templates=random.sample(HOOKS, 2),
        ideal_length_min=22.0,
        ideal_length_max=38.0,
        caption_style="bold-keyword-highlight",
        summary="Controversial AI + founder takes under 40s win; punchy hooks outperform.",
    )
    r.set(keys.PATTERNS_CURRENT, p.to_json())
    for topic in p.winning_topics:
        vs = VariantSet(
            topic=topic,
            variants=[
                Variant(
                    variant_id=f"v{i}",
                    title=f"{topic} — variant {i}",
                    caption=f"Did {topic} just change everything? #{i}",
                    hook=random.choice(HOOKS).format(guest="the guest", topic=topic),
                    thumbnail_prompt=f"bold text '{topic}', shocked face, high contrast",
                )
                for i in range(1, 4)
            ],
        )
        r.set(keys.variants_key(topic), vs.to_json())
    coord("stub", "milestone", "seeded patterns + variants")


def seed_all() -> None:
    seed_trends()
    seed_discovery()
    seed_jobs()
    seed_results()
    seed_patterns()
    coord("stub", "milestone", "ALL stub data seeded — every key populated")


def main() -> None:
    ap = argparse.ArgumentParser(description="Seed ClipPilot Redis stub data")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--trends", action="store_true")
    ap.add_argument("--discovery", action="store_true")
    ap.add_argument("--jobs", action="store_true")
    ap.add_argument("--results", action="store_true")
    ap.add_argument("--patterns", action="store_true")
    args = ap.parse_args()
    if args.all or not any(vars(args).values()):
        seed_all()
        return
    if args.trends:
        seed_trends()
    if args.discovery:
        seed_discovery()
    if args.jobs:
        seed_jobs()
    if args.results:
        seed_results()
    if args.patterns:
        seed_patterns()


if __name__ == "__main__":
    main()
