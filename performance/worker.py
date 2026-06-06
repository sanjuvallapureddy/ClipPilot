"""Lane B — worker entrypoint (REAL only).

collect (real posted metrics) -> learn (patterns from real GPT moment scores until real
engagement metrics exist) -> optimize (A/B variants). `--loop` repeats on
PATTERN_REFRESH_SECONDS. No simulation flag — there is no fake data.

  python -m performance.worker            # one pass
  python -m performance.worker --loop     # continuous
"""
from __future__ import annotations

import argparse
import os
import time

from shared.redis_client import coord

from . import collector, learn, optimize


def cycle() -> dict:
    n = collector.collect()
    patterns = learn.learn()
    topics = optimize.generate_variants(patterns.winning_topics if patterns else None)
    return {"collected": n, "topics": topics,
            "winning_topics": patterns.winning_topics if patterns else []}


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
