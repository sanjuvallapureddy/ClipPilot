"""Lane "chat" — the agent_chat worker entrypoint.

The team Slack runs in two halves:

1. ANNOUNCEMENTS (deterministic, grounded): the worker watches real contract streams
   (discovery:queue, jobs:stream, patterns:current) and posts in-character, factual
   messages from the relevant persona — e.g. Scout announces freshly queued episodes and
   pings @cutter/@coach. These never invent data.

2. REPLIES (LLM, collaborative): when a message @mentions a peer (or lands in a DM), that
   peer answers with its own system prompt + a real-state grounding. Each persona is an
   independent agent; nobody orchestrates the conversation.

Loop/cost guards keep it sane: per-thread turn cap, per-agent cooldown, a cap on how many
peers answer one message, and "react to new messages only" (start from the stream tail).

    python -m agent_chat.worker            # one tick (smoke test)
    python -m agent_chat.worker --loop     # run continuously (what the container does)
"""
from __future__ import annotations

import argparse
import os
import time

import redis

from shared import keys, personas, team_chat
from shared.redis_client import coord, get_client
from shared.schemas import DiscoveryItem

from . import brain, grounding

MAX_THREAD_TURNS = int(os.getenv("CHAT_MAX_THREAD_TURNS", "4"))
COOLDOWN_SEC = float(os.getenv("CHAT_REPLY_COOLDOWN_SEC", "2"))
MAX_REPLIES_PER_MSG = int(os.getenv("CHAT_MAX_REPLIES_PER_MSG", "2"))
TAIL_BLOCK_MS = int(os.getenv("CHAT_TAIL_BLOCK_MS", "4000"))


def _flag(name: str, default: bool) -> bool:
    return os.getenv(name, "1" if default else "0").lower() in ("1", "true", "yes")


class ChatWorker:
    def __init__(self, r: redis.Redis | None = None) -> None:
        self.r = r or get_client()
        self.last_chat = "0"
        self.last_jobs = "0"
        self.last_disc = "0"
        self.pat_ts: float | None = None
        self.thread_turns: dict[str, int] = {}
        self.last_post: dict[str, float] = {}

    # --- lifecycle ----------------------------------------------------------
    def _last_id(self, stream: str) -> str:
        rows = self.r.xrevrange(stream, count=1)
        return rows[0][0] if rows else "0"

    def start(self) -> None:
        # React only to NEW activity: anchor each cursor at the current stream tail.
        self.last_jobs = self._last_id(keys.JOBS_STREAM)
        self.last_disc = self._last_id(keys.DISCOVERY_QUEUE)
        self.last_chat = self._last_id(keys.CHAT_STREAM)
        raw = self.r.get(keys.PATTERNS_CURRENT)
        if raw:
            try:
                from shared.schemas import Patterns

                self.pat_ts = Patterns.from_json(raw).updated_at
            except Exception:
                self.pat_ts = None
        # Per CLAUDE.md §6, announce the contract addition to coord:log — once per Redis.
        if self.r.set("coord:chat-stream-announced", "1", nx=True):
            coord("chat", "contract-change",
                  "added chat:stream + ChatMessage (team-chat layer); see CLAUDE.md")
        self._seed_intros()
        if _flag("CHAT_STANDUP", True):
            self._kickoff()

    def _seed_intros(self) -> None:
        """Populate #general with self-intros once (no mentions -> no reply storm)."""
        if self.r.xlen(keys.CHAT_STREAM) > 0:
            return
        for aid in keys.AGENTS:
            team_chat.say(aid, personas.intro_line(aid), channel="general", mentions=[], r=self.r)
        coord("chat", "milestone", "team chat seeded with agent intros")

    def _kickoff(self) -> None:
        """Pilot opens with a standup that sparks one grounded conversation round."""
        snap = grounding.snapshot(self.r)
        qd = snap["queue_depth"]
        if qd:
            text = f"Morning team ☀️ {qd} episode(s) queued — @scout what's the best one to start with?"
        else:
            text = "Morning team ☀️ queue's empty — @scout can you find us something trending?"
        team_chat.say("pilot", text, channel="general", r=self.r)

    # --- announcements from real contract activity --------------------------
    def observe_discovery(self) -> None:
        resp = self.r.xread({keys.DISCOVERY_QUEUE: self.last_disc}, count=50)
        if not resp:
            return
        items: list[DiscoveryItem] = []
        for sid, fields in resp[0][1]:
            self.last_disc = sid
            try:
                items.append(DiscoveryItem.from_redis(fields))
            except Exception:
                continue
        if not items:
            return
        top = max(items, key=lambda i: i.trend_score)
        team_chat.mirror_event(
            f"Scout queued {len(items)} episode(s); top '{top.title}' ({top.trend_score}).",
            author="scout", r=self.r,
        )
        team_chat.say(
            "scout",
            f"Just queued {len(items)} fresh episodes 🛰️ top pick: \"{top.title}\" "
            f"(score {top.trend_score}). @cutter want first crack? @coach anything I should bias for?",
            channel="discovery", r=self.r,
        )

    def observe_jobs(self) -> None:
        resp = self.r.xread({keys.JOBS_STREAM: self.last_jobs}, count=50)
        if not resp:
            return
        for sid, f in resp[0][1]:
            self.last_jobs = sid
            stage = f.get("stage", "")
            title = f.get("title") or f.get("job_id", "a job")
            msg = f.get("message", "")
            team_chat.mirror_event(f"[{stage}] {title} — {msg}", author="cutter", r=self.r)
            if stage == "done":
                team_chat.say(
                    "cutter",
                    f"Done with \"{title}\" — moments are in ✂️ @coach can you grade these?",
                    channel="editing", r=self.r,
                )
            elif stage == "failed":
                team_chat.say(
                    "cutter",
                    f"Heads up @pilot — \"{title}\" failed: {f.get('error') or msg or 'unknown error'}.",
                    channel="editing", r=self.r,
                )

    def observe_patterns(self) -> None:
        raw = self.r.get(keys.PATTERNS_CURRENT)
        if not raw:
            return
        from shared.schemas import Patterns

        p = Patterns.from_json(raw)
        if self.pat_ts is None:
            self.pat_ts = p.updated_at
            return
        if not p.updated_at or p.updated_at == self.pat_ts:
            return
        self.pat_ts = p.updated_at
        topics = ", ".join(p.winning_topics[:3]) or "still gathering signal"
        team_chat.mirror_event(f"Coach refreshed patterns: {topics}.", author="coach", r=self.r)
        team_chat.say(
            "coach",
            f"📈 Updated the playbook — winning topics: {topics}; best length "
            f"{p.ideal_length_min}-{p.ideal_length_max}s. @scout bias your next picks, "
            f"@cutter lean on these hooks 👀",
            channel="performance", r=self.r,
        )

    # --- collaborative replies ---------------------------------------------
    def _responders(self, m) -> list[str]:
        if m.channel.startswith("dm:"):
            parts = m.channel[3:].split("-")
            return [p for p in parts if p != m.author and p in keys.AGENTS]
        return [a for a in m.mentions if a != m.author and a in keys.AGENTS]

    def route_replies(self) -> None:
        msgs = team_chat.tail(self.last_chat, block_ms=TAIL_BLOCK_MS, r=self.r)
        for sid, m in msgs:
            self.last_chat = sid
            if m.kind == "event":
                continue
            root = m.in_reply_to or sid
            if self.thread_turns.get(root, 0) >= MAX_THREAD_TURNS:
                continue
            snap = grounding.snapshot(self.r)
            replied = 0
            for aid in self._responders(m):
                if replied >= MAX_REPLIES_PER_MSG:
                    break
                if time.time() - self.last_post.get(aid, 0.0) < COOLDOWN_SEC:
                    continue
                history = team_chat.recent(m.channel, n=8, r=self.r)
                reply = brain.generate(aid, m.channel, history, grounding.grounding_for(aid, snap))
                if not reply or not reply.text.strip():
                    continue
                team_chat.say(
                    aid, reply.text, channel=m.channel,
                    mentions=reply.mentions, in_reply_to=root, r=self.r,
                )
                self.thread_turns[root] = self.thread_turns.get(root, 0) + 1
                self.last_post[aid] = time.time()
                replied += 1

    def tick(self) -> None:
        for step in (self.observe_discovery, self.observe_jobs, self.observe_patterns,
                     self.route_replies):
            try:
                step()
            except Exception as e:  # never let one bad read kill the loop
                coord("chat", "error", f"{step.__name__} failed: {e}")
                time.sleep(1)


def main() -> None:
    ap = argparse.ArgumentParser(description="ClipPilot agent_chat worker (team Slack)")
    ap.add_argument("--loop", action="store_true", help="run continuously")
    args = ap.parse_args()

    if not _flag("CHAT_ENABLED", True):
        print("[agent_chat] disabled via CHAT_ENABLED=0")
        return

    worker = ChatWorker()
    coord("chat", "milestone", f"agent_chat worker up (loop={args.loop})")
    worker.start()
    while True:
        worker.tick()
        if not args.loop:
            break


if __name__ == "__main__":
    main()
