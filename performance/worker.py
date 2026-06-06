"""Lane B — worker entrypoint.

Runs collect -> learn -> optimize. `--loop` repeats on PATTERN_REFRESH_SECONDS so the
system keeps learning unattended. `--simulate` seeds realistic metrics.

  python -m performance.worker --simulate          # one pass
  python -m performance.worker --simulate --loop   # continuous
"""
from __future__ import annotations

import argparse
import os
import time

from shared.redis_client import coord

from . import collector, learn, optimize


def cycle(simulate: bool) -> dict:
    n = collector.collect(simulate=simulate)
    patterns = learn.learn()
    topics = optimize.generate_variants(patterns.winning_topics if patterns else None)
    return {"collected": n, "topics": topics,
            "winning_topics": patterns.winning_topics if patterns else []}


def main() -> None:
    ap = argparse.ArgumentParser(description="ClipPilot performance worker (Lane B)")
    ap.add_argument("--simulate", action="store_true", help="seed realistic metrics")
    ap.add_argument("--loop", action="store_true", help="run continuously")
    ap.add_argument("--interval", type=int,
                    default=int(os.getenv("PATTERN_REFRESH_SECONDS", "300")))
    args = ap.parse_args()

    coord("B", "milestone", f"performance worker up (simulate={args.simulate}, loop={args.loop})")
    while True:
        out = cycle(args.simulate)
        print(f"[performance] {out}")
        if not args.loop:
            break
        time.sleep(args.interval)


if __name__ == "__main__":
    main()
