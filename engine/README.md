# Lane C — Engine (real viral-moment detection)

FastAPI service exposing the ClipPilot contract. Runs a **real** pipeline with no mock
data:

1. `POST /process {youtube_url, config}` → `{job_id}`; `GET /status/{job_id}`.
2. **Real transcript** via `engine/transcript.py` — YouTube captions through yt-dlp
   (Whisper fallback on downloaded audio). No synthetic text.
3. **Real moment detection** (`pipeline._detect_moments`) — GPT scores real transcript
   windows on podcast virality factors (`engine/scoring.py`: humor, controversy, insight,
   emotional intensity, trend relevance) and returns the top real moments (real quote,
   timestamps, hook, score, reason).
4. Writes `results:{clip_id}` with `render_status=pending` / `post_status=not_posted` and
   advances `jobs:{id}` / `jobs:stream` (queued → fetching → transcribing → analyzing →
   done). Needs `OPENAI_API_KEY`; without it the job fails honestly (no invented moments).

## Render + posting (not yet wired)
Producing the actual 9:16 short and publishing it is OpenShorts' job (yt-dlp ingest,
faster-whisper, FFmpeg cut/reframe, captions, Upload-Post). **We do not reimplement it.**
To enable: `git clone https://github.com/mutonby/openshorts engine/openshorts`, wire its
entrypoint where noted in `engine/pipeline.py`, set `UPLOAD_POST_API_KEY`, and have the
publisher flip `render_status`/`post_status` + fill metrics. Until then those fields stay
honest. Any contract change → post to `coord:log` + update `CLAUDE.md` (§6).

## Run
```bash
uvicorn engine.app:app --port 8001
curl -X POST localhost:8001/process -H 'content-type: application/json' \
  -d '{"youtube_url":"https://youtube.com/watch?v=REAL_ID","title":"Lex Fridman","topic":"ai"}'
curl localhost:8001/status/<job_id>
```
