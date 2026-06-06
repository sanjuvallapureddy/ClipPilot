FROM python:3.11-slim
WORKDIR /app
COPY performance/requirements.txt /app/req.txt
RUN pip install --no-cache-dir -r /app/req.txt
COPY shared /app/shared
COPY performance /app/performance
ENV PYTHONUNBUFFERED=1 PERFORMANCE_SIMULATE=1
CMD ["python", "-m", "performance.worker", "--simulate", "--loop"]
