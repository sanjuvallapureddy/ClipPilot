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
shared/                          the contract: keys.py + schemas.py + types.ts
```

Data flow:
`discovery:queue → jobs:{id} → transcript+GPT moments → results:{clip} → patterns:current → (back to A)`

See **CLAUDE.md** for the full contract table and build order.

## Real data, no mocks
ClipPilot runs on real data only — there are no stub/seed/simulate paths:
- **Discovery** uses real YouTube search via `yt-dlp` (real titles, channels, **real view
  counts**) — needs no API key.
- **Viral-moment detection** pulls the **real transcript** (YouTube captions via yt-dlp,
  Whisper fallback) and GPT picks real moments (real quote, timestamps, hook, score) —
  needs `OPENAI_API_KEY`.
- **Video render** (OpenShorts) and **posting** (Upload-Post + platform creds) are not
  wired yet, so clips show honest `render_status=pending` / `post_status=not_posted` and
  metrics stay zero until real numbers exist — never simulated.

## Quick start
```bash
cp .env.example .env                      # set OPENAI_API_KEY (for moment detection)
docker run -d --name clippilot-redis -p 6379:6379 redis/redis-stack:latest
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

uvicorn engine.app:app --port 8001                       # Lane C
uvicorn discovery_orchestrator.app:app --port 8000       # Lane A
python -m performance.worker --loop                      # Lane B
cd dashboard && npm i && npm run dev                     # Lane D -> http://localhost:3000
```

Trigger one full real cycle (discover → detect moments):
```bash
curl -X POST localhost:8000/run-once -H 'content-type: application/json' -d '{"topic":"tech"}'
curl localhost:8000/status
```

Or in the dashboard copilot, type:
> *find trending tech podcasts and clip the most controversial moments*

## Full stack via Docker
```bash
cp .env.example .env   # set OPENAI_API_KEY (+ UPLOAD_POST_API_KEY for render/post later)
docker compose up --build
```
