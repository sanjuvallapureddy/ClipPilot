#!/usr/bin/env python
"""ClipPilot — browser-use research harness (ISOLATED, STANDALONE).

This script is executed by the dedicated ``.venv-harness`` interpreter
(browser-use 0.12.9 + playwright 1.60.0, which pull in openai>=2 / starlette>=1).
It is intentionally NOT imported by Lane A: Lane A's ``.venv`` pins
fastapi/starlette/openai at versions browser-use would upgrade and break, so all
browser-use code lives behind a subprocess boundary. ``web_research.py`` invokes
this file via ``subprocess.run`` and parses its stdout.

Usage:
    python harness_runner.py "<topic>"

Output contract:
    A JSON array is printed to **stdout only**, shaped as
    ``[{"title": str, "topic": str, "maybe_url": str}, ...]``.
    All browser-use / agent chatter goes to stderr (or is swallowed), so the
    caller can parse the last JSON array on stdout.

Honest degradation (REAL DATA ONLY rule):
    If ``OPENAI_API_KEY`` is missing, or browser-use is unavailable, or ANYTHING
    raises, this prints ``[]`` and exits 0. It never fabricates leads.

Verified import API for browser-use 0.12.9:
    from browser_use import Agent, Browser, ChatOpenAI
    agent = Agent(task=..., llm=ChatOpenAI(model="gpt-5.5"), browser=Browser(headless=True))
    history = await agent.run(max_steps=18); text = history.final_result()
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sys


def _emit(leads: list) -> None:
    """Print ONLY the JSON array to stdout and flush."""
    if not isinstance(leads, list):
        leads = []
    sys.stdout.write(json.dumps(leads))
    sys.stdout.flush()


def _extract_json_array(text: str) -> list:
    """Best-effort: pull the last JSON array of objects out of the agent's text.

    Robust to surrounding prose / markdown fences the model may add around the
    JSON. Returns [] if nothing parseable is found.
    """
    if not text:
        return []
    text = text.strip()
    # Fast path: the whole string is already a JSON array.
    try:
        val = json.loads(text)
        if isinstance(val, list):
            return val
    except Exception:
        pass
    # Otherwise scan for bracketed arrays and take the LAST parseable one.
    for chunk in reversed(re.findall(r"\[.*?\]", text, re.DOTALL)):
        try:
            val = json.loads(chunk)
            if isinstance(val, list):
                return val
        except Exception:
            continue
    return []


def _normalize(raw: list, topic: str) -> list:
    """Coerce arbitrary model output into the lead contract."""
    out: list = []
    for item in raw if isinstance(raw, list) else []:
        if isinstance(item, dict):
            title = str(
                item.get("title") or item.get("episode") or item.get("name") or ""
            ).strip()
            t = str(
                item.get("topic") or item.get("show") or item.get("podcast") or topic
            ).strip()
            url = str(
                item.get("maybe_url") or item.get("url") or item.get("youtube_url") or ""
            ).strip()
        elif isinstance(item, str):
            title, t, url = item.strip(), topic, ""
        else:
            continue
        if not title and not url:
            continue
        out.append({"title": title, "topic": t or topic, "maybe_url": url})
    return out


async def _close(browser) -> None:
    for name in ("kill", "stop", "close"):
        fn = getattr(browser, name, None)
        if fn is None:
            continue
        try:
            res = fn()
            if asyncio.iscoroutine(res):
                await res
            return
        except Exception:
            continue


async def _research(topic: str) -> list:
    # Imported lazily so a missing key short-circuits before touching browser-use.
    from browser_use import Agent, Browser, ChatOpenAI

    llm = ChatOpenAI(model=os.getenv("OPENAI_MODEL", "gpt-5.5"))
    browser = Browser(headless=True)
    task = (
        "Find the podcast episodes and topics most discussed / trending THIS WEEK "
        f"about {topic}. Search YouTube and the open web. Return concrete episode "
        "titles, show names, and YouTube URLs where possible. Finish by returning "
        'ONLY a JSON array shaped as [{"title": "...", "topic": "...", '
        '"maybe_url": "..."}] with up to 10 items and no other text.'
    )
    agent = Agent(task=task, llm=llm, browser=browser)
    try:
        history = await agent.run(max_steps=int(os.getenv("HARNESS_MAX_STEPS", "18")))
        result = history.final_result()
    finally:
        await _close(browser)
    return _normalize(_extract_json_array(result or ""), topic)


def main() -> int:
    topic = ((sys.argv[1] if len(sys.argv) > 1 else "") or "").strip() or "tech"
    # No key -> no real research is possible; degrade honestly.
    if not os.getenv("OPENAI_API_KEY"):
        _emit([])
        return 0
    try:
        leads = asyncio.run(_research(topic))
    except Exception as e:  # never fabricate; surface the reason on stderr only
        print(f"[harness_runner] failed: {e}", file=sys.stderr)
        _emit([])
        return 0
    _emit(leads)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
