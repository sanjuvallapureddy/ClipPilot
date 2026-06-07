"""Lane B — worker entrypoint (REAL only).

collect (real posted metrics) -> learn (patterns from real GPT moment scores until real
engagement metrics exist) -> insight (self-learning: why the winner beat the loser, then
auto-apply it to patterns:current) -> optimize (A/B variants). `--loop` repeats on
PATTERN_REFRESH_SECONDS. No simulation flag — there is no fake data, and the self-learning
loop is always on (mandatory, never behind a flag).

  python -m performance.worker            # one pass
  python -m performance.worker --loop     # continuous
"""
from __future__ import annotations

import argparse
import os
import time

from shared import keys
from shared.redis_client import coord, get_client
from shared.schemas import Patterns

from . import collector, insights, learn, optimize


def cycle() -> dict:
    n = collector.collect()
    patterns = learn.learn()
    # self-learning: compare winner vs loser, explain why, auto-apply to patterns:current
    insight = insights.run_insight()
    # re-read patterns so optimize runs off the (possibly insight-updated) winners
    patterns = Patterns.from_json(get_client().get(keys.PATTERNS_CURRENT)) or patterns
    topics = optimize.generate_variants(patterns.winning_topics if patterns else None)
    return {
        "collected": n,
        "topics": topics,
        "winning_topics": patterns.winning_topics if patterns else [],
        "insight": (
            {"why": insight.why, "signal_source": insight.signal_source,
             "applied": insight.applied}
            if insight else None
        ),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="ClipPilot performance worker (Lane B)")
    ap.add_argument("--loop", action="store_true", help="run continuously")
    ap.add_argument("--interval", type=int,
                    default=int(os.getenv("PATTERN_REFRESH_SECONDS", "300")))
    args = ap.parse_args()

    coord("B", "milestone", f"performance worker up (loop={args.loop})")
    while True:
        out = cycle()
        print(f"[performance] {out}")
        if not args.loop:
            break
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
