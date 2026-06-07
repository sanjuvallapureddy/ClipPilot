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
import inspect
import os
from typing import Any, Callable, TypeVar

F = TypeVar("F", bound=Callable[..., Any])

_initialized = False
_weave: Any = None


def _sync_api_key() -> None:
    """Allow pasting the key as WEAVE_API_KEY in .env; the weave/wandb SDK reads
    WANDB_API_KEY, so mirror it over when only the friendly alias is set."""
    alias = os.getenv("WEAVE_API_KEY")
    if alias and not os.getenv("WANDB_API_KEY"):
        os.environ["WANDB_API_KEY"] = alias


def _has_wandb_auth() -> bool:
    """W&B auth via env var (WANDB_API_KEY / WEAVE_API_KEY) or a stored credentials
    file from `wandb login` (`~/.netrc` on macOS/Linux, `~/_netrc` on Windows)."""
    _sync_api_key()
    if os.getenv("WANDB_API_KEY"):
        return True
    home = os.path.expanduser("~")
    return any(os.path.exists(os.path.join(home, n)) for n in (".netrc", "_netrc"))


def enabled() -> bool:
    """True when a Weave project and W&B auth are both configured."""
    return bool(os.getenv("WEAVE_PROJECT")) and _has_wandb_auth()


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

    Works for both sync and ``async def`` functions. The traced wrapper is created lazily
    on first call (after ``init``), so decoration at import time is free and never requires
    weave to be present. When tracing is off, this adds nothing but a function call.
    """

    def deco(fn: F) -> F:
        cache: dict[str, Callable[..., Any]] = {}

        def _traced() -> Callable[..., Any]:
            t = cache.get("fn")
            if t is None:
                try:
                    t = _weave.op(name=name)(fn) if name else _weave.op()(fn)
                except Exception:
                    t = fn
                cache["fn"] = t
            return t

        if inspect.iscoroutinefunction(fn):

            @functools.wraps(fn)
            async def awrapper(*args: Any, **kwargs: Any) -> Any:
                if init() and _weave is not None:
                    return await _traced()(*args, **kwargs)
                return await fn(*args, **kwargs)

            return awrapper  # type: ignore[return-value]

        @functools.wraps(fn)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            if init() and _weave is not None:
                return _traced()(*args, **kwargs)
            return fn(*args, **kwargs)

        return wrapper  # type: ignore[return-value]

    return deco
