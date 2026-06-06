# ClipPilot 🎬🤖

Autonomous shorts factory: **finds trending podcasts → clips the most viral moments into
9:16 shorts → auto-posts to TikTok/IG/YouTube → measures performance → learns what wins →
repeats.** No human in the loop after launch.

Built at Fire Hacks (24h) by a 4-person team. Sponsors: **OpenAI · Redis · CopilotKit ·
Upload-Post · OpenShorts**.

> We do **not** build the clipping pipeline — [OpenShorts](https://github.com/mutonby/openshorts)
> (MIT) renders & publishes. ClipPilot is the **autonomy layer** on top.

## Architecture
Four independent lanes that talk **only** through a Redis contract (`shared/`) + the
OpenShorts API:

```
Lane A  discovery-orchestrator/  trending discovery + the autonomous loop (FastAPI)
Lane B  performance/             metrics collection + pattern learning + A/B variants
Lane C  engine/                  OpenShorts wrapper: POST /process -> {job_id}
Lane D  dashboard/               Next.js + CopilotKit mission control
shared/                          the contract: keys.py + schemas.py + types.ts + stubs.py
```

Data flow:
`discovery:queue → jobs:{id} → OpenShorts → results:{clip} → patterns:current → (back to A)`

See **CLAUDE.md** for the full contract table and build order.

## Quick start (MOCK mode — works with zero external keys)
```bash
cp .env.example .env
docker compose up redis -d
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m shared.stubs --all              # seed every Redis key with fake data

uvicorn engine.app:app --port 8001                       # Lane C
uvicorn discovery_orchestrator.app:app --port 8000       # Lane A
python -m performance.worker --simulate --loop           # Lane B
cd dashboard && npm i && npm run dev                     # Lane D -> http://localhost:3000
```

Trigger one full autonomous cycle:
```bash
curl -X POST localhost:8000/run-once
curl localhost:8000/status
```

Or in the dashboard copilot, type:
> *find trending tech podcasts and clip the most controversial moments*

## Full stack via Docker
```bash
cp .env.example .env   # fill OPENAI_API_KEY, YOUTUBE_API_KEY for REAL mode
docker compose up --build
```

## Modes
- `ENGINE_MODE=MOCK` — fakes rendering/posting but honors the full contract (demo-safe).
- `ENGINE_MODE=REAL` — calls vendored OpenShorts (`engine/openshorts/`).
- `PERFORMANCE_SIMULATE=1` — seeds realistic metrics so analytics work before platform
  numbers land.
