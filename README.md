# ClipPilot

Autonomous multi-agent pipeline for discovering trending long-form video, clipping viral moments into 9:16 shorts, posting to social platforms, and feeding performance back into discovery.

Built at Fire Hacks by a 4-person team. Four async Python lanes (A/B/C + agent chat) plus a Next.js dashboard (Lane D) communicate **only** through a shared Redis contract in `shared/keys.py`.

---

## Sponsor tools — how we actually use them (with file evidence)

Each integration below is wired in production code paths, not marketing copy. Paths are relative to the repo root.

### 1. Redis — contract layer between all lanes

**What it does:** Single source of truth for discovery queues, job state, clip results, patterns, coordination logs, and team chat.

**Evidence:**

| Primitive | Key / stream | File |
|-----------|--------------|------|
| Discovery queue | `discovery:queue` (Stream) | `shared/keys.py`, Lane A writes via `discovery_orchestrator/` |
| Job hashes | `jobs:{job_id}` (Hash) | `shared/redis_client.py` → `write_job()` |
| Job events | `jobs:stream` (Stream) | `shared/redis_client.py` → `emit_job_event()` |
| Clip results | `results:{clip_id}` (Hash), `results:all` (Set) | `shared/keys.py`, Lane C writes in `engine/pipeline.py` |
| Winning patterns | `patterns:current` (JSON string) | Lane B writes in `performance/worker.py`, Lane A reads in `discovery_orchestrator/app.py` |
| Coordination log | `coord:log` (Stream) | `shared/redis_client.py` → `coord()` |
| Team chat | `chat:stream` (Stream) | `shared/keys.py`, `agent_chat/worker.py` tails and posts |
| Vector search | `idx:trends` (RediSearch HNSW) | `shared/redis_client.py` → `ensure_trends_index()` |

**Dashboard bridge:** `dashboard/lib/redis.ts` reads the same keys server-side (ioredis). API routes: `dashboard/app/api/queue/route.ts`, `clips/route.ts`, `analytics/route.ts`.

**Note:** Chat uses **Redis Streams** (`XADD` / `XREAD`), not Pub/Sub. Requires **redis-stack** (RediSearch + RedisJSON) for the trends vector index.

---

### 2. OpenAI — embeddings, GPT scoring, Whisper, copilot chat

**What it does:** Trend embeddings, moment/hook scoring, agent chat personas, dashboard CopilotKit chat, and voice transcription fallback.

**Evidence:**

| Use | File |
|-----|------|
| Embeddings (`text-embedding-3-small`, 1536-dim) | `shared/keys.py` (`TREND_VECTOR_DIM`), discovery scoring |
| GPT moment / virality scoring | `engine/pipeline.py`, `discovery_orchestrator/discovery.py` |
| Agent team chat (Scout/Cutter/Coach/Pilot) | `agent_chat/brain.py`, `shared/personas.py` |
| CopilotKit sidebar chat | `dashboard/app/api/copilotkit/[[...all]]/route.ts` (`OpenAIAdapter`, `COPILOT_MODEL`) |
| Voice → text (Whisper) | `dashboard/app/api/transcribe/route.ts` |

Env: `OPENAI_API_KEY`, `OPENAI_MODEL`, `EMBED_MODEL`, `COPILOT_MODEL`, `CHAT_MODEL` in `.env.example`.

---

### 3. CopilotKit — mission-control copilot in the dashboard

**What it does:** In-app AI that **operates** ClipPilot via server actions instead of giving generic coding advice.

**Evidence:**

| Feature | File |
|---------|------|
| Runtime + OpenAI adapter | `dashboard/app/api/copilotkit/[[...all]]/route.ts` |
| Readable context (orchestrator status, queue, clips, virality) | `dashboard/app/page.tsx` — six `useCopilotReadable` hooks |
| Actions: discover, research, run pipeline, start/stop loop, analytics | `dashboard/app/page.tsx` — `useCopilotAction` |
| State-aware suggestion chips | `useCopilotChatSuggestions` in `page.tsx`, `ViralityPredictor.tsx` |
| Generative UI cards for action results | `render` callbacks on each `useCopilotAction` |
| Sidebar shell | `dashboard/components/Sidebar.tsx` (CopilotKit sidebar provider in layout) |

Control bridge proxies to Lane A: `dashboard/app/api/control/route.ts` → `DISCOVERY_API_URL`.

---

### 4. OpenShorts — vertical clip render pipeline (Lane C)

**What it does:** Submits YouTube URLs to OpenShorts for download → moment detection → 9:16 reframe → caption burn; polls job status and collects served clip URLs.

**Evidence:**

| Step | File |
|------|------|
| `POST /api/process`, poll `/api/status/{job_id}` | `engine/openshorts_client.py` |
| Per-clip subtitle burn | `POST /api/subtitle` in `engine/openshorts_client.py` |
| Pipeline integration | `engine/pipeline.py` |
| Most-replayed window pre-selection (yt-dlp heatmap) | `engine/most_replayed.py` |
| Title overlay burn (ffmpeg) | `engine/overlay.py`, `engine/titles.py` |

Env: `OPENSHORTS_API_URL`, `OPENSHORTS_PUBLIC_URL`, `OPENSHORTS_TIMEOUT_SECONDS`.

Clips carry honest `render_status` (`pending` until OpenShorts returns a file) — see `shared/schemas.py` (`ClipResult`).

---

### 5. Upload-Post — guarded social publishing (Lane C)

**What it does:** Posts rendered shorts to TikTok / Instagram / YouTube when credentials and a real rendered file exist. **No fake posts.**

**Evidence:**

| Step | File |
|------|------|
| Guarded publish hook | `engine/publish.py` → `publish_clip()` |
| Requires `UPLOAD_POST_API_KEY` + `render_status=="rendered"` + file on disk | `engine/publish.py` lines 37–48 |
| Performance metrics collection | `performance/collector.py` |

Env: `UPLOAD_POST_API_KEY` in `.env.example`.

---

### 6. Weave (Weights & Biases) — optional LLM tracing (Lane C)

**What it does:** Traces GPT calls in the engine pipeline when `WEAVE_PROJECT` + `WANDB_API_KEY` are set. No-op otherwise.

**Evidence:**

| Step | File |
|------|------|
| `@weave.op()` wrapper, safe no-op fallback | `engine/observability.py` |
| Used in pipeline scoring | `engine/pipeline.py` imports `observability.op` |
| Dashboard status panel | `dashboard/components/WeaveObservability.tsx`, `dashboard/app/api/weave/status/route.ts` |

Env: `WEAVE_PROJECT`, `WANDB_API_KEY` / `WEAVE_API_KEY`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  LANE D — dashboard/ (Next.js 14 + CopilotKit)                          │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │ reads/writes Redis + proxies Lane A
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  REDIS CONTRACT — shared/keys.py, shared/schemas.py, dashboard/lib/types.ts │
│  discovery:queue → jobs:{id} → results:{clip_id} → patterns:current     │
└──────┬─────────────────────────────┬─────────────────────────────┬──────┘
       ▼                             ▼                             ▼
┌──────────────┐              ┌──────────────┐              ┌──────────────┐
│  LANE A      │              │  LANE B      │              │  LANE C      │
│  discovery-  │              │  performance/│              │  engine/     │
│  orchestrator│              │  metrics +   │              │  OpenShorts  │
│  :8000       │              │  patterns    │              │  wrapper :8001│
└──────────────┘              └──────────────┘              └──────────────┘
       agent_chat/worker — peer LLM personas on chat:stream (Scout/Cutter/Coach/Pilot)
```

| Lane | Path | Role |
|------|------|------|
| A | `discovery_orchestrator/` | Trend discovery, queueing, autonomous loop (`/start`, `/stop`, `/run-once`) |
| B | `performance/` | Polls post metrics, writes `patterns:current` |
| C | `engine/` | Transcript + GPT moments → OpenShorts render → Upload-Post |
| D | `dashboard/` | Mission control UI, CopilotKit, analytics |
| Chat | `agent_chat/` | Streams-backed team workspace |

---

## Quick start (local)

**Prerequisites:** Python 3.10+, Node.js 18+, Redis (Docker or [Memurai](https://www.memurai.com/) on Windows).

```powershell
# 1. Configure env
cp .env.example .env
# Set OPENAI_API_KEY. For local dev, DISCOVERY_API_URL=http://localhost:8000

# 2. Bootstrap Redis + Lane A (Windows)
.\scripts\start-local.ps1

# 3. Dashboard
cd dashboard
npm install
npm run dev
```

Open **http://localhost:3000**. Sidebar shows **systems online** when Lane A responds at `http://localhost:8000/health`.

### Manual services (all platforms)

```bash
# Redis (Docker)
docker run -d --name clippilot-redis -p 6379:6379 redis/redis-stack:latest

python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

uvicorn discovery_orchestrator.app:app --port 8000   # Lane A
uvicorn engine.app:app --port 8001                    # Lane C
python -m performance.worker --loop                   # Lane B
python -m agent_chat.worker --loop                      # Team chat

cd dashboard && npm run dev                           # Lane D
```

### Trigger a test cycle

```bash
curl -X POST http://localhost:8000/run-once \
  -H 'content-type: application/json' \
  -d '{"topic":"tech"}'
```

---

## Orchestrator status (dashboard)

The sidebar polls `GET /api/control` every 4s (`dashboard/components/AppChrome.tsx`). That route:

1. Checks Lane A `GET /health` (no Redis required)
2. Falls back to `GET /status` for queue depth + loop state

**"Orchestrator down"** means nothing is listening on port **8000** — start Lane A (see above). If Lane A is up but Redis is down, the dashboard stays online and shows a Redis hint.

---

## Virality scores

Contract stores `engagement_score` / `trend_score` as **0–1 floats** in Redis. The dashboard displays **0–100 whole numbers** via `dashboard/lib/format.ts` → `formatScore()` (multiply by 100 when ≤ 1, then round).

---

## Real data policy

No fake pipeline states: clips show `render_status=pending` until OpenShorts renders; `post_status=not_posted` until Upload-Post succeeds; views stay **0** until Lane B collects real metrics.
