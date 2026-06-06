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
- **B — `performance/`** (Python): collect REAL posted metrics → learn `patterns:current`
  → generate A/B variants. No simulation.
- **C — `engine/`** (FastAPI): `POST /process {youtube_url, config}` → `{job_id}`;
  `GET /status/{job_id}`. Real pipeline: yt-dlp transcript → GPT moment detection.
- **D — `dashboard/`** (Next.js 14 + CopilotKit + AG-UI): mission control.

## The Redis contract — the ONLY interface between lanes
Source of truth: `shared/keys.py` (+ `shared/schemas.py`, mirrored in `shared/types.ts`).

| Key | Type | Writers → Readers |
|-----|------|-------------------|
| `discovery:queue` | Stream (consumer group `orchestrator`) | A → A |
| `seen:{video_id}` | string + TTL (14d) | A |
| `jobs:{job_id}` | Hash (stages: queued→fetching→transcribing→analyzing→done\|failed) | A,C → D |
| `jobs:stream` | Stream of status changes | A,C → D |
| `results:{clip_id}` | Hash (quote/hook/start/end/score; render_status/post_status; metrics when posted) | C,D → B |
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

## REAL DATA ONLY — no mocks/stubs/sims
Discovery = real yt-dlp YouTube search (real view counts, no key). Moment detection =
real transcript (yt-dlp captions / Whisper) + GPT (needs `OPENAI_API_KEY`). Render
(OpenShorts) + posting (Upload-Post creds) are unwired → clips carry
`render_status=pending` / `post_status=not_posted`; metrics stay 0 until real. Never fake.

## Build order (done)
1. ✅ `shared/` contract + docker-compose + .env.example + CLAUDE.md + README.
2. ✅ Real discovery (yt-dlp) + orchestrator + control API.
3. ✅ Real engine (transcript → GPT moments).
4. ✅ Dashboard tailing live jobs + copilot actions.
5. ✅ Lane B real metrics + `patterns:current`; loop closes into Lane A.

## Sponsors (use meaningfully): OpenAI · Redis · CopilotKit · (OpenShorts/Upload-Post for render+post).

## Run locally
```bash
cp .env.example .env            # set OPENAI_API_KEY
docker run -d --name clippilot-redis -p 6379:6379 redis/redis-stack:latest
pip install -r requirements.txt
uvicorn engine.app:app --port 8001                  # Lane C
uvicorn discovery_orchestrator.app:app --port 8000  # Lane A
python -m performance.worker --loop                 # Lane B
cd dashboard && npm i && npm run dev                 # Lane D -> localhost:3000
```
