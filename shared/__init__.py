"""ClipPilot shared contract package: Redis keys + payload schemas + helpers."""
from pathlib import Path as _Path

try:
    # Load the project-root .env so every lane run locally honors it, matching the
    # docker-compose `env_file: .env` behavior. override=False keeps real env vars
    # (e.g. docker-compose `environment:` blocks) authoritative over the file.
    from dotenv import load_dotenv as _load_dotenv

    _load_dotenv(_Path(__file__).resolve().parent.parent / ".env", override=False)
except Exception:  # python-dotenv optional; env may come from the shell/docker
    pass

from . import keys  # noqa: F401,E402
from .schemas import (  # noqa: F401,E402
    ClipResult,
    CoordMessage,
    DiscoveryItem,
    EngineConfig,
    EngineStatus,
    Job,
    JobEvent,
    LearningInsight,
    Patterns,
    ProcessRequest,
    ProcessResponse,
    Variant,
    VariantSet,
)
