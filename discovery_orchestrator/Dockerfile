FROM python:3.11-slim
WORKDIR /app
COPY discovery_orchestrator/requirements.txt /app/req.txt
RUN pip install --no-cache-dir -r /app/req.txt
COPY shared /app/shared
COPY discovery_orchestrator /app/discovery_orchestrator
ENV PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["uvicorn", "discovery_orchestrator.app:app", "--host", "0.0.0.0", "--port", "8000"]
