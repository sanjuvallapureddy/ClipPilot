# Lane C — Engine (OpenShorts wrapper)

Thin FastAPI wrapper that exposes the ClipPilot contract over OpenShorts. **We do not
reimplement OpenShorts' pipeline** (yt-dlp ingest, faster-whisper transcription,
viral-moment detection, FFmpeg cutting, 9:16 face-tracking reframe, captions/hooks,
Upload-Post publishing). We only:

1. expose `POST /process {youtube_url, config}` → `{job_id}` and `GET /status/{job_id}`,
2. provide a **podcast-tuned scoring prompt** over our factors (humor, controversy,
   insight, emotional intensity, trend relevance) with an OpenAI|Gemini switch
   (`engine/scoring.py`),
3. write the contract outputs: `results:{clip_id}` skeletons (with Upload-Post post ids)
   and advance `jobs:{id}` / `jobs:stream`.

## Modes
- **MOCK** (default, demo-safe): simulates the pipeline + sandbox posting with zero
  external deps. Honors the full Redis contract.
- **REAL**: delegates to vendored OpenShorts. See `pipeline._run_real`.

## Vendoring OpenShorts (for REAL mode)
```bash
git clone https://github.com/mutonby/openshorts engine/openshorts
# install its deps (ffmpeg, yt-dlp, faster-whisper, etc.) per its README
```
Then verify the actual entrypoint and wire it in `engine/pipeline._run_real` (the
intended call is sketched there). **Any contract-affecting change → post to `coord:log`
and update `CLAUDE.md` (§6).** Configure Upload-Post via `UPLOAD_POST_API_KEY` /
`UPLOAD_POST_SANDBOX`.

## Run
```bash
uvicorn engine.app:app --port 8001
curl -X POST localhost:8001/process -H 'content-type: application/json' \
  -d '{"youtube_url":"https://youtube.com/watch?v=abc","title":"All-In","topic":"ai agents"}'
curl localhost:8001/status/<job_id>
```
