"""Per-persona reply generation.

`generate()` produces ONE agent's next message as a real LLM call using that agent's own
system prompt (shared/personas.py) plus the recent channel history and real-state
grounding. Output is the JSON contract from the persona prompt. With no OPENAI_API_KEY (or
on any error) it falls back to a short templated line so the workspace still "talks"
offline — the fallback never @mentions anyone, so it gently ends a thread instead of
looping.
"""
from __future__ import annotations

import json
import os

from shared import keys, personas
from shared.schemas import ChatMessage


def _model() -> str:
    # Keep this a FAST chat model (many small calls); mirrors the dashboard COPILOT_MODEL.
    return os.getenv("CHAT_MODEL") or os.getenv("COPILOT_MODEL") or "gpt-4o-mini"


def _history_block(history: list[tuple[str, ChatMessage]]) -> str:
    lines = []
    for _sid, m in history[-8:]:
        who = keys.AGENTS.get(m.author, {}).get("name", m.author)
        lines.append(f"{who}: {m.text}")
    return "\n".join(lines) if lines else "(no messages yet)"


def generate(
    agent_id: str,
    channel: str,
    history: list[tuple[str, ChatMessage]],
    grounding_text: str,
) -> ChatMessage | None:
    """The next message from `agent_id`, or None to stay silent."""
    if not os.getenv("OPENAI_API_KEY"):
        return _templated(agent_id, channel, history)
    try:
        from openai import OpenAI

        where = "a direct message" if channel.startswith("dm:") else f"the #{channel} channel"
        user = (
            f"You are chatting in {where}.\n"
            f"REAL STATE you can see right now: {grounding_text}\n\n"
            f"Recent messages:\n{_history_block(history)}\n\n"
            "Write your next message as yourself, following your JSON output contract."
        )
        client = OpenAI()
        resp = client.chat.completions.create(
            model=_model(),
            messages=[
                {"role": "system", "content": personas.system_prompt(agent_id)},
                {"role": "user", "content": user},
            ],
            response_format={"type": "json_object"},
            temperature=0.6,
            max_tokens=160,
        )
        d = json.loads(resp.choices[0].message.content)
        if not d.get("reply", True):
            return None
        text = (d.get("text") or "").strip()
        if not text:
            return None
        mentions = [
            m for m in (d.get("mentions") or [])
            if m in keys.AGENTS and m != agent_id
        ]
        return ChatMessage(author=agent_id, channel=channel, text=text, mentions=mentions)
    except Exception:
        return _templated(agent_id, channel, history)


_FALLBACK_LINES = {
    "scout": "on it — scanning for trending episodes now 🛰️",
    "cutter": "queue it up and I'll find the moments ✂️",
    "coach": "I'll fold that into the playbook 📈",
    "pilot": "nice — keeping us moving 🎬",
}


def _templated(
    agent_id: str,
    channel: str,
    history: list[tuple[str, ChatMessage]],
) -> ChatMessage | None:
    """Offline fallback: a short, mention-free acknowledgement (ends the thread cleanly)."""
    text = _FALLBACK_LINES.get(agent_id, "")
    if not text:
        return None
    last = history[-1][1] if history else None
    if last and last.author != agent_id:
        name = keys.AGENTS.get(last.author, {}).get("name", last.author)
        text = f"{name}, {text}"
    return ChatMessage(author=agent_id, channel=channel, text=text, mentions=[])
