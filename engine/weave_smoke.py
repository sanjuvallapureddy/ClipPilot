"""Weave connectivity check — confirms Weights & Biases tracing is wired correctly.

This is a diagnostic, NOT part of the product data path: it traces a trivial pure
function (no Redis, no GPT, no clip data) purely to verify that ``@observability.op``
records a trace in your W&B project.

Usage:
    pip install -r requirements-weave.txt
    wandb login                      # or: set WANDB_API_KEY=...
    set WEAVE_PROJECT=clippilot      # PowerShell: $env:WEAVE_PROJECT="clippilot"
    python -m engine.weave_smoke

If WANDB_API_KEY / WEAVE_PROJECT aren't set, the op runs as a transparent no-op and the
script tells you tracing is OFF (it still succeeds — proving the safe fallback works).
"""
from __future__ import annotations

import os

from engine import observability


@observability.op("weave_connectivity_check")
def probe(n: int) -> dict:
    """Trivial traced op used only to verify Weave logging end-to-end."""
    return {"n": n, "squared": n * n, "service": "clippilot-engine"}


def main() -> None:
    live = observability.init()
    project = os.getenv("WEAVE_PROJECT") or "(unset)"
    print(f"WEAVE_PROJECT={project}  tracing_live={live}")

    for i in range(1, 4):
        print("traced ->", probe(i))

    if live:
        print("OK — open https://wandb.ai and look for the 'weave_connectivity_check' trace.")
    else:
        print(
            "Tracing is OFF (safe no-op). Run `wandb login` and set WEAVE_PROJECT, "
            "then re-run to send real traces."
        )


if __name__ == "__main__":
    main()
