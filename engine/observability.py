"""Optional Weights & Biases **Weave** tracing for the engine (Lane C).

Weave (https://wandb.me/weave) auto-captures the inputs, outputs, latency, exceptions,
token usage and the nested call tree of any function wrapped with ``weave.op()``. We use
it to trace the REAL moment-detection pipeline so every GPT virality pass shows up as an
LLM trace in the W&B UI — which is exactly the kind of observability a hackathon W&B
submission needs.

Safe-by-default: if ``weave`` isn't installed, or ``WEAVE_PROJECT`` / ``WANDB_API_KEY``
aren't set, ``op`` becomes a transparent no-op decorator and nothing is sent anywhere.
Importing this module therefore never breaks the engine, and there is no hard dependency.

Enable it with:
    pip install weave
    export WANDB_API_KEY=...            # from https://wandb.ai/authorize
    export WEAVE_PROJECT=clippilot      # <entity>/<project> or just <project>
"""
from __future__ import annotations

import functools
import os
from typing import Any, Callable, TypeVar

F = TypeVar("F", bound=Callable[..., Any])

_initialized = False
_weave: Any = None


def enabled() -> bool:
    """True when a Weave project and W&B auth are both configured."""
    has_auth = bool(os.getenv("WANDB_API_KEY") or os.path.exists(
        os.path.expanduser("~/.netrc")
    ))
    return bool(os.getenv("WEAVE_PROJECT")) and has_auth


def init() -> bool:
    """Initialize Weave exactly once. Returns True when tracing is live."""
    global _initialized, _weave
    if _initialized:
        return _weave is not None
    _initialized = True
    if not enabled():
        return False
    try:
        import weave  # type: ignore

        weave.init(os.getenv("WEAVE_PROJECT", "clippilot"))
        _weave = weave
        try:
            from shared.redis_client import coord

            coord("C", "milestone", f"Weave tracing ON → {os.getenv('WEAVE_PROJECT')}")
        except Exception:
            pass
        return True
    except Exception:
        _weave = None
        return False


def op(name: str | None = None) -> Callable[[F], F]:
    """Trace a function as a Weave op when tracing is enabled, otherwise no-op.

    The traced wrapper is created lazily on first call (after ``init``), so decoration
    at import time is free and never requires weave to be present.
    """

    def deco(fn: F) -> F:
        cache: dict[str, Callable[..., Any]] = {}

        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            if init() and _weave is not None:
                traced = cache.get("fn")
                if traced is None:
                    try:
                        traced = _weave.op(name=name)(fn) if name else _weave.op()(fn)
                    except Exception:
                        traced = fn
                    cache["fn"] = traced
                return traced(*args, **kwargs)
            return fn(*args, **kwargs)

        return wrapper  # type: ignore[return-value]

    return deco
