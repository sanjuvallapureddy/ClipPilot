# Lane D — Mission Control Dashboard (Next.js 14 + CopilotKit)

CopilotKit provider + AG-UI wired to Lane A's control API. Views:
- **Live Pipeline** — tails `jobs:stream` via the SSE route `/api/jobs/stream`.
- **Discovered Queue** — latest `discovery:queue` items with trend scores.
- **Clips Gallery** — every `results:{clip_id}` with per-platform post status.
- **Analytics** — engagement timeline + current winning `patterns:current`.

## Copilot (generative UI) actions
Registered client-side in `app/page.tsx` with live `render`:
- `discoverPodcasts(topic)` · `runPipeline(topic?)` · `showAnalytics()`

Backend control/status actions live in `app/api/copilotkit/route.ts`
(`startAutonomous`, `stopAutonomous`, `getStatus`).

**Demo:** in the copilot sidebar type
> *find trending tech podcasts and clip the most controversial moments*

→ the LLM calls `discoverPodcasts("tech")` then `runPipeline()`; cards render live and
the Live Pipeline streams stage updates in real time.

## Bridge
Server API routes (`app/api/*`) read Redis directly (`lib/redis.ts`, ioredis) and proxy
control actions to Lane A (`DISCOVERY_API_URL`). No business logic — just the contract.

## Run
```bash
npm i
# needs: REDIS_URL, DISCOVERY_API_URL, OPENAI_API_KEY (for the copilot LLM)
npm run dev   # http://localhost:3000
```
