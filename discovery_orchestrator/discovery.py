"""Lane A — Discovery.

Pull candidate podcast episodes (YouTube Data API v3), summarize each to a one-line
topic, embed it (OpenAI text-embedding-3-small), query the `idx:trends` vector index for
trend fit, then score virality+fit with a GPT structured call -> trend_score. Push top N
to `discovery:queue`.

Degrades gracefully: with no YOUTUBE_API_KEY it uses a curated candidate list; with no
OPENAI_API_KEY it uses deterministic embeddings + heuristic scoring. So Lane A runs
standalone (per §6) even with zero secrets.
"""
from __future__ import annotations

import hashlib
import json
import os
import struct
import uuid
from datetime import datetime, timezone

from shared import keys
from shared.redis_client import coord, ensure_trends_index, get_client
from shared.schemas import DiscoveryItem, Patterns

# --- curated seeds (used when no YouTube key, and to seed the trend index) ---
SEED_TRENDS = [
    "ai agents and autonomous software",
    "startup fundraising and venture capital",
    "longevity and human healthspan",
    "crypto regulation and tokens",
    "founder psychology and burnout",
    "AGI timelines and risk",
]
CURATED_CANDIDATES = [
    ("The All-In Podcast", "https://youtube.com/watch?v=allin1", "AI agents will eat SaaS", "ai agents"),
    ("Lex Fridman Podcast", "https://youtube.com/watch?v=lex1", "AGI timelines debate", "AGI timelines and risk"),
    ("My First Million", "https://youtube.com/watch?v=mfm1", "How to raise a seed round fast", "startup fundraising and venture capital"),
    ("Huberman Lab", "https://youtube.com/watch?v=hub1", "The one longevity protocol that works", "longevity and human healthspan"),
    ("The Diary of a CEO", "https://youtube.com/watch?v=doac1", "Founder burnout is a silent epidemic", "founder psychology and burnout"),
    ("Acquired", "https://youtube.com/watch?v=acq1", "Why crypto regulation changes everything", "crypto regulation and tokens"),
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- embeddings ---------------------------------------------------------------

def _deterministic_embed(text: str, dim: int = keys.TREND_VECTOR_DIM) -> list[float]:
    """Stable pseudo-embedding from a hash seed — used when no OpenAI key."""
    seed = int(hashlib.sha256(text.encode()).hexdigest(), 16)
    vec = []
    x = seed
    for _ in range(dim):
        x = (1103515245 * x + 12345) & 0x7FFFFFFF
        vec.append((x / 0x7FFFFFFF) * 2 - 1)
    # normalize
    norm = sum(v * v for v in vec) ** 0.5 or 1.0
    return [v / norm for v in vec]


def embed(text: str) -> list[float]:
    if not os.getenv("OPENAI_API_KEY"):
        return _deterministic_embed(text)
    try:
        from openai import OpenAI

        client = OpenAI()
        resp = client.embeddings.create(
            model=os.getenv("EMBED_MODEL", keys.EMBED_MODEL), input=text[:8000]
        )
        return resp.data[0].embedding
    except Exception as e:  # pragma: no cover
        coord("A", "error", f"embed fallback: {e}")
        return _deterministic_embed(text)


def _to_bytes(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def seed_trend_index(extra: list[str] | None = None) -> None:
    """Embed seed trends (+ optional fresh headlines) into trend:{id} for vector search."""
    r = get_client()
    ensure_trends_index(r)
    for i, topic in enumerate(SEED_TRENDS + (extra or [])):
        tid = f"seed-{i}"
        vec = embed(topic)
        doc = {"topic": topic, "source": "seed", "vector": vec}
        try:
            r.json().set(keys.trend_key(tid), "$", doc)
        except Exception:
            r.hset(keys.trend_key(tid), mapping={"topic": topic, "source": "seed"})
    coord("A", "info", f"seeded {len(SEED_TRENDS) + len(extra or [])} trends into idx:trends")


def trend_fit(topic_summary: str) -> float:
    """KNN against idx:trends; return a 0-1 fit score (1 - cosine distance of best match)."""
    r = get_client()
    vec = embed(topic_summary)
    try:
        from redis.commands.search.query import Query

        q = (
            Query("*=>[KNN 1 @vector $vec AS dist]")
            .sort_by("dist")
            .return_fields("dist", "topic")
            .dialect(2)
            .paging(0, 1)
        )
        res = r.ft(keys.TRENDS_INDEX).search(q, query_params={"vec": _to_bytes(vec)})
        if res.docs:
            dist = float(res.docs[0].dist)  # cosine distance 0..2
            return max(0.0, min(1.0, 1.0 - dist / 2.0))
    except Exception as e:
        # vector search unavailable (e.g. plain redis): cheap lexical fallback
        best = 0.0
        for t in SEED_TRENDS:
            overlap = len(set(t.split()) & set(topic_summary.lower().split()))
            best = max(best, overlap / max(len(t.split()), 1))
        return best
    return 0.0


# --- candidate sourcing -------------------------------------------------------

def fetch_youtube_candidates(query: str, max_results: int = 10) -> list[dict]:
    """YouTube Data API v3 search. Returns [] (caller falls back) if no key/error."""
    api_key = os.getenv("YOUTUBE_API_KEY")
    if not api_key:
        return []
    try:
        from googleapiclient.discovery import build

        yt = build("youtube", "v3", developerKey=api_key)
        resp = (
            yt.search()
            .list(q=query + " podcast", part="snippet", type="video",
                  order="viewCount", maxResults=max_results, relevanceLanguage="en")
            .execute()
        )
        out = []
        for item in resp.get("items", []):
            vid = item["id"]["videoId"]
            sn = item["snippet"]
            out.append({
                "video_id": vid,
                "youtube_url": f"https://youtube.com/watch?v={vid}",
                "title": sn["title"],
                "podcast": sn["channelTitle"],
                "published_at": sn.get("publishedAt", _now_iso()),
            })
        return out
    except Exception as e:  # pragma: no cover
        coord("A", "error", f"youtube fetch failed: {e}")
        return []


# --- virality scoring ---------------------------------------------------------

def _heuristic_score(title: str, fit: float) -> tuple[float, str]:
    title_l = title.lower()
    pop = sum(w in title_l for w in
              ["why", "truth", "secret", "never", "wrong", "shocking", "ai", "crypto",
               "billion", "controversial", "nobody"]) / 5.0
    score = round(min(1.0, 0.45 * min(pop, 1.0) + 0.45 * fit + 0.10), 3)
    return score, "heuristic: clickable terms + trend fit"


def score_virality(title: str, topic_summary: str, fit: float,
                   patterns: Patterns | None = None) -> tuple[float, str]:
    """GPT structured-output virality+fit score; heuristic fallback w/o key."""
    if not os.getenv("OPENAI_API_KEY"):
        return _heuristic_score(title, fit)
    try:
        from openai import OpenAI

        bias = ""
        if patterns and patterns.winning_topics:
            bias = f"Recently winning topics (boost these): {', '.join(patterns.winning_topics)}."
        prompt = (
            "Score this podcast episode's short-form viral potential 0-1. Consider: "
            "controversy, emotional intensity, humor, surprising insight, and trend "
            f"relevance (trend fit={fit:.2f}). {bias}\n"
            f"Title: {title}\nTopic: {topic_summary}\n"
            'Return JSON: {"trend_score": <0-1>, "reason": "<short>"}'
        )
        client = OpenAI()
        resp = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"}, temperature=0.4,
        )
        d = json.loads(resp.choices[0].message.content)
        return round(float(d.get("trend_score", fit)), 3), str(d.get("reason", ""))
    except Exception as e:  # pragma: no cover
        coord("A", "error", f"score fallback: {e}")
        return _heuristic_score(title, fit)


# --- top-level discover -------------------------------------------------------

def discover(topic: str = "tech", top_n: int | None = None,
             patterns: Patterns | None = None) -> list[DiscoveryItem]:
    """Run one discovery pass and push top-N items to discovery:queue."""
    top_n = top_n or int(os.getenv("DISCOVERY_TOP_N", "5"))
    r = get_client()
    seed_trend_index()

    raw = fetch_youtube_candidates(topic)
    using_curated = not raw
    if using_curated:
        raw = [
            {"video_id": uuid.uuid4().hex[:11], "youtube_url": url, "title": title,
             "podcast": pod, "published_at": _now_iso(), "_topic": tsum}
            for (pod, url, title, tsum) in CURATED_CANDIDATES
        ]

    scored: list[DiscoveryItem] = []
    for c in raw:
        topic_summary = c.get("_topic") or f"{c['title']} (podcast clip about {topic})"
        fit = trend_fit(topic_summary)
        ts, reason = score_virality(c["title"], topic_summary, fit, patterns)
        scored.append(DiscoveryItem(
            youtube_url=c["youtube_url"], title=c["title"], podcast=c.get("podcast", ""),
            topic=topic_summary, published_at=c.get("published_at", _now_iso()),
            trend_score=ts, source="youtube" if not using_curated else "seed",
        ))

    scored.sort(key=lambda x: x.trend_score, reverse=True)
    top = scored[:top_n]
    for item in top:
        r.xadd(keys.DISCOVERY_QUEUE, item.to_redis(), maxlen=500, approximate=True)
    coord("A", "milestone",
          f"discovered {len(top)}/{len(scored)} candidates for '{topic}' "
          f"(curated={using_curated}) -> discovery:queue")
    return top
