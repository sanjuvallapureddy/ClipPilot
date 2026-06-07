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
- **Team chat — `agent_chat/`** (Python worker): a peer "Slack" layer. The four lanes show
  up as named teammates (Scout/Cutter/Coach/Pilot) that converse in channels + DMs over
  `chat:stream` — no orchestrator of the conversation; each persona replies with its own
  system prompt (genuinely told to collaborate). Real LLM; templated fallback without a key.

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
| `patterns:current` | JSON (winning topics/hooks/length/caption + self-learned hook_style/first_line_strategy/avoid_topics/insight_summary) | B → A |
| `patterns:variants:{topic}` | JSON variant configs | B → C,A |
| `insights:latest` | JSON `LearningInsight` (why winner beat loser; signal_source=real_views\|predicted_virality; recommendations; applied) | B → D |
| `insights:stream` | Stream of `LearningInsight` (self-learning audit history) | B → D |
| `trend:{id}` + `idx:trends` | JSON + RediSearch HNSW COSINE 1536-dim (text-embedding-3-small) | A |
| `coord:log` | Stream (multiagent coordination) | all |
| `chat:stream` | Stream of `ChatMessage` — team "Slack": channels + DMs, 4 lanes as peer agents (Scout/Cutter/Coach/Pilot) | all (driven by `agent_chat`) |

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
6. ✅ Self-learning loop (Lane B v2): `performance/insights.py` ranks clips by the best
   REAL signal (real views once posted, else GPT predicted virality), compares winner vs
   loser, explains why, and auto-applies the lesson into `patterns:current` (honored by
   Lane C's moment-detection prompt). Always on every `worker.cycle()`. Surfaced in the
   dashboard "Learning" tab + `explainWhyItWon` copilot action.
7. ✅ Team chat (agent "Slack", `agent_chat/`): the four lanes converse as peers over
   `chat:stream` (channels + DMs, @mentions). Deterministic, grounded announcements from real
   contract activity + LLM peer replies driven by per-persona system prompts that explicitly
   ask them to collaborate. Read-only "Team Chat" tab in the dashboard; loop/cost guards;
   works offline via templated fallback.
8. ✅ Clip titles + on-video title headline (Lane C): every clip gets ONE GPT-generated
   title (`engine/titles.py`) used in TWO places — burned across the top of the vertical
   short so the audience sees it (`engine/overlay.py`: Pillow renders the headline to a
   transparent PNG, ffmpeg composites it with `overlay`; NOT a reimplementation of
   OpenShorts' caption burner — cutting/reframing/word-synced captions stay in OpenShorts)
   AND as the YouTube video title at upload. The titled short is written to the engine's
   served `media/` dir and `results:{clip_id}.title` + `.clip_url` point at it; the dashboard
   "Upload to YouTube" publishes that real titled file with that title (no contract keys
   changed — `title`/`clip_url` were already in the contract). Burn is best-effort: needs
   ffmpeg/ffprobe, degrades to the un-titled OpenShorts clip otherwise.

## Sponsors (use meaningfully): OpenAI · Redis · CopilotKit · (OpenShorts/Upload-Post for render+post).

## Run locally
```bash
cp .env.example .env            # set OPENAI_API_KEY
docker run -d --name clippilot-redis -p 6379:6379 redis/redis-stack:latest
pip install -r requirements.txt
uvicorn engine.app:app --port 8001                  # Lane C
uvicorn discovery_orchestrator.app:app --port 8000  # Lane A
python -m performance.worker --loop                 # Lane B
python -m agent_chat.worker --loop                  # Team chat (agent "Slack")
cd dashboard && npm i && npm run dev                 # Lane D -> localhost:3000
```
