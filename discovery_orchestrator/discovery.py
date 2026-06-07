"""Lane A — Discovery (REAL data only).

Pulls REAL candidate podcast episodes from YouTube via yt-dlp search (no API key
required) — real titles, channels, URLs, and view counts. Scores virality from the real
view count + a GPT structured-output call on the real title, blended with trend fit from
the `idx:trends` vector index (which is built up from the real topics we actually see —
no seeded/placeholder trend list). Pushes the top N to `discovery:queue`.

There is NO mock/curated fallback. If YouTube returns nothing, discovery returns nothing.
The only graceful degradation is the *scoring math*: with no OPENAI_API_KEY the trend
score is computed from real view counts + a title heuristic (still real data, just a
simpler model).
"""
from __future__ import annotations

import math
import os
import re
import struct
from datetime import datetime, timezone

from shared import keys
from shared.redis_client import coord, ensure_trends_index, get_client
from shared.schemas import DiscoveryItem, Patterns


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# --- embeddings (real OpenAI; required for vector search) ---------------------

def embed(text: str) -> list[float] | None:
    """Real embedding via OpenAI. Returns None if no key (vector search then skipped)."""
    if not os.getenv("OPENAI_API_KEY"):
        return None
    try:
        from openai import OpenAI

        client = OpenAI()
        resp = client.embeddings.create(
            model=os.getenv("EMBED_MODEL", keys.EMBED_MODEL), input=text[:8000]
        )
        return resp.data[0].embedding
    except Exception as e:  # pragma: no cover
        coord("A", "error", f"embed failed: {e}")
        return None


def _to_bytes(vec: list[float]) -> bytes:
    return struct.pack(f"{len(vec)}f", *vec)


def index_topic(topic_id: str, topic: str, source: str = "discovered") -> None:
    """Store a REAL observed topic in idx:trends so the trend space is built from
    actual content we've seen (no seeded placeholders)."""
    vec = embed(topic)
    if vec is None:
        return
    r = get_client()
    ensure_trends_index(r)
    try:
        r.json().set(keys.trend_key(topic_id), "$", {"topic": topic, "source": source, "vector": vec})
    except Exception:
        pass


def trend_fit(topic_summary: str) -> float:
    """KNN against idx:trends (real accumulated topics). 0.0 on cold start / no key."""
    vec = embed(topic_summary)
    if vec is None:
        return 0.0
    r = get_client()
    try:
        from redis.commands.search.query import Query

        q = (
            Query("*=>[KNN 1 @vector $vec AS dist]")
            .sort_by("dist").return_fields("dist").dialect(2).paging(0, 1)
        )
        res = r.ft(keys.TRENDS_INDEX).search(q, query_params={"vec": _to_bytes(vec)})
        if res.docs:
            return max(0.0, min(1.0, 1.0 - float(res.docs[0].dist) / 2.0))
    except Exception:
        return 0.0
    return 0.0


# --- real candidate sourcing via yt-dlp --------------------------------------

_ISO8601_DURATION = re.compile(
    r"P(?:(?P<days>\d+)D)?T?(?:(?P<hours>\d+)H)?(?:(?P<minutes>\d+)M)?(?:(?P<seconds>\d+)S)?"
)


def _parse_iso8601_duration(s: str) -> float:
    """Parse a YouTube `contentDetails.duration` (e.g. 'PT1H2M3S') to seconds."""
    if not s:
        return 0.0
    m = _ISO8601_DURATION.fullmatch(s)
    if not m:
        return 0.0
    parts = {k: int(v) for k, v in m.groupdict(default="0").items()}
    return float(parts["days"] * 86400 + parts["hours"] * 3600
                 + parts["minutes"] * 60 + parts["seconds"])


def _keep_episode(c: dict) -> bool:
    """Drop channel-trailer / very short / zero-length entries; keep real episodes."""
    return bool(c["title"]) and (c["duration"] == 0 or c["duration"] >= 300)


def _fetch_via_data_api(topic: str, max_results: int = 12) -> list[dict]:
    """REAL YouTube Data API search: search.list -> videos.list for real stats.

    Quota: search.list costs 100 units; videos.list is 1 unit per call (<=50 ids), so a
    pass is ~101 units. Callers gate discovery to an empty queue to stay within quota.
    """
    key = os.getenv("YOUTUBE_API_KEY")
    if not key:
        return []
    try:
        from googleapiclient.discovery import build

        yt = build("youtube", "v3", developerKey=key, cache_discovery=False)
        search = yt.search().list(
            q=f"{topic} podcast", part="id", type="video",
            maxResults=min(max_results, 50), order="relevance", relevanceLanguage="en",
        ).execute()
        ids = [it["id"]["videoId"] for it in search.get("items", [])
               if it.get("id", {}).get("videoId")]
        if not ids:
            return []
        details = yt.videos().list(
            part="snippet,statistics,contentDetails", id=",".join(ids),
        ).execute()
    except Exception as e:  # real failure -> empty, never faked
        coord("A", "error", f"YouTube Data API failed: {e}")
        return []

    out: list[dict] = []
    for v in details.get("items", []):
        vid = v.get("id")
        sn = v.get("snippet", {})
        st = v.get("statistics", {})
        cd = v.get("contentDetails", {})
        if not vid:
            continue
        out.append({
            "video_id": vid,
            "youtube_url": f"https://youtube.com/watch?v={vid}",
            "title": sn.get("title") or "",
            "podcast": sn.get("channelTitle") or "",
            "view_count": int(st.get("viewCount") or 0),
            "like_count": int(st.get("likeCount") or 0),
            "duration": _parse_iso8601_duration(cd.get("duration", "")),
            "published_at": sn.get("publishedAt") or _now_iso(),
        })
    return [c for c in out if _keep_episode(c)]


def _fetch_via_ytdlp(topic: str, max_results: int = 12) -> list[dict]:
    """REAL YouTube search via yt-dlp (no API key). Fallback when YOUTUBE_API_KEY unset."""
    query = f"ytsearch{max_results}:{topic} podcast"
    opts = {
        "quiet": True, "no_warnings": True, "extract_flat": True, "skip_download": True,
    }
    out: list[dict] = []
    try:
        import yt_dlp

        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(query, download=False)
        for e in (info or {}).get("entries", []) or []:
            vid = e.get("id")
            if not vid:
                continue
            out.append({
                "video_id": vid,
                "youtube_url": e.get("url") or f"https://youtube.com/watch?v={vid}",
                "title": e.get("title") or "",
                "podcast": e.get("channel") or e.get("uploader") or "",
                "view_count": int(e.get("view_count") or 0),
                "like_count": int(e.get("like_count") or 0),
                "duration": float(e.get("duration") or 0),
                "published_at": _now_iso(),
            })
    except Exception as e:  # real failure -> empty, never faked
        coord("A", "error", f"yt-dlp search failed: {e}")
    return [c for c in out if _keep_episode(c)]


def fetch_candidates(topic: str, max_results: int = 12) -> list[dict]:
    """REAL candidate episodes. Prefer the YouTube Data API (real view/like stats);
    fall back to yt-dlp search when YOUTUBE_API_KEY is unset. Real data either way."""
    if os.getenv("YOUTUBE_API_KEY"):
        items = _fetch_via_data_api(topic, max_results)
        if items:
            return items
        coord("A", "info", "Data API returned nothing; falling back to yt-dlp search")
    return _fetch_via_ytdlp(topic, max_results)


# --- virality scoring (real signals) -----------------------------------------

def _views_score(views: int) -> float:
    """Normalize a real view count to 0-1 on a log scale (10 -> 1M)."""
    if views <= 0:
        return 0.0
    return max(0.0, min(1.0, (math.log10(views) - 1) / 5.0))


def _title_heuristic(title: str) -> float:
    t = title.lower()
    hits = sum(w in t for w in
               ["why", "truth", "secret", "never", "wrong", "shocking", "controversial",
                "nobody", "$", "billion", "ai", "crypto", "future", "exclusive"])
    return min(1.0, hits / 5.0)


def score_virality(title: str, topic_summary: str, views: int, fit: float,
                   patterns: Patterns | None = None) -> tuple[float, str]:
    """Blend real view count + trend fit + GPT (or heuristic) title virality."""
    vscore = _views_score(views)
    if not os.getenv("OPENAI_API_KEY"):
        s = 0.45 * vscore + 0.35 * _title_heuristic(title) + 0.20 * fit
        return round(min(1.0, s), 3), f"views={views:,} (no LLM key: heuristic)"
    try:
        import json

        from openai import OpenAI

        bias = ""
        if patterns and patterns.winning_topics:
            bias = f" Recently winning topics (boost): {', '.join(patterns.winning_topics)}."
        prompt = (
            "Rate this REAL podcast episode's short-form viral potential 0-1 based on the "
            "title's controversy, curiosity, emotional pull and timeliness. "
            f"It has {views:,} views (trend fit={fit:.2f}).{bias}\n"
            f"Title: {title}\n"
            'Return JSON {"title_score": <0-1>, "reason": "<short>"}'
        )
        client = OpenAI()
        resp = client.chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-5.5"),
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},  # gpt-5.x: only default temperature (1)
        )
        d = json.loads(resp.choices[0].message.content)
        title_score = float(d.get("title_score", 0.5))
        blended = 0.4 * vscore + 0.4 * title_score + 0.2 * fit
        return round(min(1.0, blended), 3), str(d.get("reason", ""))
    except Exception as e:  # pragma: no cover
        coord("A", "error", f"score failed: {e}")
        s = 0.45 * vscore + 0.35 * _title_heuristic(title) + 0.20 * fit
        return round(min(1.0, s), 3), f"views={views:,}"


# --- top-level discover -------------------------------------------------------

def discover(topic: str = "tech", top_n: int | None = None,
             patterns: Patterns | None = None) -> list[DiscoveryItem]:
    """Run one REAL discovery pass and push top-N items to discovery:queue."""
    top_n = top_n or int(os.getenv("DISCOVERY_TOP_N", "5"))
    r = get_client()

    raw = fetch_candidates(topic)
    if not raw:
        coord("A", "info", f"no real candidates found for '{topic}'")
        return []

    scored: list[DiscoveryItem] = []
    for c in raw:
        topic_summary = c["title"]
        fit = trend_fit(topic_summary)
        ts, reason = score_virality(c["title"], topic_summary, c["view_count"], fit, patterns)
        index_topic(c["video_id"], topic_summary)  # grow the real trend space
        scored.append(DiscoveryItem(
            youtube_url=c["youtube_url"], title=c["title"], podcast=c["podcast"],
            topic=topic_summary, published_at=c["published_at"],
            trend_score=ts, source="youtube",
        ))

    scored.sort(key=lambda x: x.trend_score, reverse=True)
    top = scored[:top_n]
    for item in top:
        r.xadd(keys.DISCOVERY_QUEUE, item.to_redis(), maxlen=500, approximate=True)
    coord("A", "milestone",
          f"discovered {len(top)}/{len(scored)} REAL episodes for '{topic}' -> discovery:queue")
    return top
