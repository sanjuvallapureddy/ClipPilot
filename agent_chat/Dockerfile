FROM python:3.11-slim
WORKDIR /app
COPY agent_chat/requirements.txt /app/req.txt
RUN pip install --no-cache-dir -r /app/req.txt
COPY shared /app/shared
COPY agent_chat /app/agent_chat
ENV PYTHONUNBUFFERED=1
CMD ["python", "-m", "agent_chat.worker", "--loop"]
