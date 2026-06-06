# ClipPilot — Build Plan & Multiagent Rules

Autonomous agent: finds trending podcasts → clips viral moments into vertical shorts →
auto-posts to TikTok/IG/YouTube → measures performance → learns → repeats. **No human
in the loop after launch.**

## Golden rule
**Do NOT build the clipping pipeline.** We use **OpenShorts**
(`github.com/mutonby/openshorts`, MIT) for yt-dlp ingest, faster-whisper transcription,
viral-moment detection, FFmpeg cutting, 9:16 face-tracking reframe, captions/hooks, and
posting via Upload-Post. **Reuse it. Do not reimplement any of it.** We build only the
autonomy layer.

**Ask first before:** reimplementing transcription/cutting/reframing/captioning; adding
fal.ai or ElevenLabs; hardcoding any API key; changing the Redis contract (§ below)
without logging it to `coord:log` and here.

## Lanes (independent modules; talk ONLY via Redis contract + OpenShorts API)
- **A — `discovery-orchestrator/`** (Python, FastAPI + scheduler): discovery + the
  autonomous loop + control API (`/run-once`, `/start`, `/stop`, `/status`).
- **B — `performance/`** (Python): collect metrics → learn `patterns:current` →
  generate A/B variants. Has `--simulate`.
- **C — `engine/`** (OpenShorts wrapper, FastAPI): `POST /process {youtube_url, config}`
  → `{job_id}`; `GET /status/{job_id}`. `ENGINE_MODE=MOCK|REAL`.
- **D — `dashboard/`** (Next.js 14 + CopilotKit + AG-UI): mission control.

## The Redis contract — the ONLY interface between lanes
Source of truth: `shared/keys.py` (+ `shared/schemas.py`, mirrored in `shared/types.ts`).

| Key | Type | Writers → Readers |
|-----|------|-------------------|
| `discovery:queue` | Stream (consumer group `orchestrator`) | A → A |
| `seen:{video_id}` | string + TTL (14d) | A |
| `jobs:{job_id}` | Hash (stages: queued→submitted→rendering→publishing→done\|failed) | A,C → D |
| `jobs:stream` | Stream of status changes | A,C → D |
| `results:{clip_id}` | Hash (views/likes/shares/watch_time/engagement_score) | C,D → B |
| `results:all` | Set of clip_ids | C,D → B |
| `patterns:current` | JSON (winning topics/hooks/length/caption) | B → A |
| `patterns:variants:{topic}` | JSON variant configs | B → C,A |
| `trend:{id}` + `idx:trends` | JSON + RediSearch HNSW COSINE 1536-dim (text-embedding-3-small) | A |
| `coord:log` | Stream (multiagent coordination) | all |

OpenShorts API (C defines, A calls): `POST /process {youtube_url, config}` → `{job_id}`;
`GET /status/{job_id}` → `{stage, progress, clips, ...}`.

## Multiagent coordination rules (§6)
- Each lane is an independent agent/module. No lane reads another's internal code/state —
  only contract keys.
- Coordinate ONLY via (1) the Redis contract and (2) `coord:log`.
- Any contract change → post to `coord:log` AND update this file before merge.
- Every lane ships stub producers/consumers with fake data → all four run in isolation
  from minute one (`python -m shared.stubs --all`).

## Build order (commit after each)
1. ✅ `shared/` contract + docker-compose + .env.example + CLAUDE.md + README.
2. ✅ Stub generators for every key (`shared/stubs.py`).
3. Lane C reachable headlessly: one YouTube URL → clip → sandbox post.
4. Lane A discovery → `discovery:queue` → orchestrator → engine via `run-once`.
5. Lane D dashboard tailing live jobs + copilot `runPipeline()`.
6. Lane B results + `patterns:current`; close the loop into Lane A selection.
7. End-to-end autonomous run on a schedule + analytics + polish.

## Vertical slice (ship first if time short)
one podcast → one clip → one live (sandbox) post → shown on the dashboard.

## Sponsors (use meaningfully): OpenAI · Redis · CopilotKit · Upload-Post · OpenShorts.

## Run locally
```bash
cp .env.example .env            # fill keys (or leave MOCK/simulate on)
docker compose up redis -d
pip install -r requirements.txt
python -m shared.stubs --all    # seed every key
uvicorn engine.app:app --port 8001            # Lane C (MOCK)
uvicorn discovery_orchestrator.app:app --port 8000  # Lane A
python -m performance.worker --simulate       # Lane B
cd dashboard && npm i && npm run dev           # Lane D -> localhost:3000
```
