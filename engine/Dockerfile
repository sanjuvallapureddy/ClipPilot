FROM python:3.11-slim
WORKDIR /app
# Engine wrapper deps (MOCK mode). REAL mode additionally needs the vendored
# OpenShorts repo + its deps (yt-dlp, faster-whisper, ffmpeg) — see engine/README.md.
COPY requirements.txt /app/engine-requirements.txt
RUN pip install --no-cache-dir -r /app/engine-requirements.txt
COPY shared /app/shared
COPY engine /app/engine
ENV PYTHONUNBUFFERED=1 ENGINE_MODE=MOCK
EXPOSE 8001
CMD ["uvicorn", "engine.app:app", "--host", "0.0.0.0", "--port", "8001"]
