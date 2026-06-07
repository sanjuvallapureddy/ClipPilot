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
from pathlib import Path

from engine import observability


def _load_env_file() -> None:
    """Dependency-free loader for the project-root .env so a key pasted there is honored
    when running this script standalone (the engine itself loads .env via `shared`)."""
    p = Path(__file__).resolve().parent.parent / ".env"
    if not p.exists():
        return
    for raw in p.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.split("#", 1)[0].strip()
        if key and val and key not in os.environ:
            os.environ[key] = val


@observability.op("weave_connectivity_check")
def probe(n: int) -> dict:
    """Trivial traced op used only to verify Weave logging end-to-end."""
    return {"n": n, "squared": n * n, "service": "clippilot-engine"}


def main() -> None:
    _load_env_file()
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
