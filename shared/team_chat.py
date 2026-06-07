"""Team chat ("agent Slack") helpers — a human-readable layer over `coord:log`.

The four lanes appear as named peers (see `keys.AGENTS`) that converse in channels and
DMs on the `chat:stream`. This module is the single read/write surface for that stream;
the `agent_chat` worker uses it to voice personas and route @-replies. The message shape
lives in `shared/schemas.py` (`ChatMessage`). Posting here is a normal contract
interaction (§6); changing the *shape* is a contract change.
"""
from __future__ import annotations

import re

import redis

from . import keys
from .redis_client import get_client
from .schemas import ChatMessage

MENTION_RE = re.compile(r"@([a-z0-9_]+)", re.I)


def extract_mentions(text: str) -> list[str]:
    """Pull @handles out of free text, keeping only those that are real agent ids."""
    found = [m.lower() for m in MENTION_RE.findall(text or "")]
    # de-dupe, preserve order, drop unknown handles
    return [a for a in dict.fromkeys(found) if a in keys.AGENTS]


def say(
    author: str,
    text: str,
    channel: str = "general",
    mentions: list[str] | None = None,
    in_reply_to: str = "",
    kind: str = "chat",
    r: redis.Redis | None = None,
) -> str:
    """Post a message to `chat:stream` and return its stream id.

    Mentions are auto-detected from the text when not supplied explicitly.
    """
    r = r or get_client()
    if mentions is None:
        mentions = extract_mentions(text)
    msg = ChatMessage(
        author=author,
        channel=channel,
        text=text,
        mentions=mentions,
        in_reply_to=in_reply_to,
        kind=kind,
    )
    return r.xadd(keys.CHAT_STREAM, msg.to_redis(), maxlen=2000, approximate=True)


def mirror_event(
    text: str,
    author: str = "pilot",
    channel: str = "activity",
    r: redis.Redis | None = None,
) -> str:
    """Post a `kind="event"` line (mirrored real pipeline activity).

    Event messages carry no mentions, so the worker never treats them as something to
    reply to — they just make the workspace feel alive in the #activity channel.
    """
    return say(author, text, channel=channel, mentions=[], kind="event", r=r)


def recent(
    channel: str | None = None,
    n: int = 50,
    r: redis.Redis | None = None,
) -> list[tuple[str, ChatMessage]]:
    """Most recent messages (oldest-first), optionally filtered to a single channel."""
    r = r or get_client()
    raw = r.xrevrange(keys.CHAT_STREAM, count=n if channel is None else n * 6)
    out: list[tuple[str, ChatMessage]] = []
    for sid, fields in raw:
        msg = ChatMessage.from_redis(fields)
        if channel and msg.channel != channel:
            continue
        out.append((sid, msg))
        if len(out) >= n:
            break
    out.reverse()
    return out


def tail(
    last_id: str = "$",
    block_ms: int = 5000,
    count: int = 50,
    r: redis.Redis | None = None,
) -> list[tuple[str, ChatMessage]]:
    """Blocking read of new chat messages after `last_id`. Returns [(stream_id, msg)]."""
    r = r or get_client()
    resp = r.xread({keys.CHAT_STREAM: last_id}, block=block_ms, count=count)
    if not resp:
        return []
    _, entries = resp[0]
    return [(sid, ChatMessage.from_redis(fields)) for sid, fields in entries]
