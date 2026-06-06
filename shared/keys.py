"""ClipPilot Redis key contract — the ONLY interface between lanes.

Any change here MUST be posted to `coord:log` and reflected in CLAUDE.md before merge.
See §4 of the build spec. Mirrored in `shared/types.ts` for the dashboard.
"""

# --- Discovery (Lane A) ---
DISCOVERY_QUEUE = "discovery:queue"  # Stream
SEEN_PREFIX = "seen:"  # string + TTL; key = f"seen:{video_id}"
SEEN_TTL_SECONDS = 60 * 60 * 24 * 14  # 14 days


def seen_key(video_id: str) -> str:
    return f"{SEEN_PREFIX}{video_id}"


# --- Jobs (Lane A & C write; D reads) ---
JOBS_PREFIX = "jobs:"  # Hash; key = f"jobs:{job_id}"
JOBS_STREAM = "jobs:stream"  # Stream of job-status changes


def job_key(job_id: str) -> str:
    return f"{JOBS_PREFIX}{job_id}"


# --- Results (Lane C & D write; B reads) ---
RESULTS_PREFIX = "results:"  # Hash; key = f"results:{clip_id}"


def result_key(clip_id: str) -> str:
    return f"{RESULTS_PREFIX}{clip_id}"


RESULTS_INDEX = "idx:results"  # optional helper set of clip_ids
RESULTS_SET = "results:all"  # Set of all clip_ids for iteration

# --- Patterns (Lane B writes; A reads) ---
PATTERNS_CURRENT = "patterns:current"  # JSON string
PATTERNS_VARIANTS_PREFIX = "patterns:variants:"  # JSON; key = f"patterns:variants:{topic}"


def variants_key(topic: str) -> str:
    return f"{PATTERNS_VARIANTS_PREFIX}{topic}"


# --- Trends vector index (Lane A) ---
TREND_PREFIX = "trend:"  # Hash with `vector` field; key = f"trend:{id}"
TRENDS_INDEX = "idx:trends"  # RediSearch vector index name
TREND_VECTOR_DIM = 1536  # text-embedding-3-small
EMBED_MODEL = "text-embedding-3-small"


def trend_key(trend_id: str) -> str:
    return f"{TREND_PREFIX}{trend_id}"


# --- Coordination (all lanes) ---
COORD_LOG = "coord:log"  # Stream

# --- Consumer groups ---
ORCHESTRATOR_GROUP = "orchestrator"
ORCHESTRATOR_CONSUMER = "orchestrator-1"

# --- Job stages (state machine) ---
STAGES = ["queued", "submitted", "rendering", "publishing", "done", "failed"]
PLATFORMS = ["tiktok", "instagram", "youtube"]
