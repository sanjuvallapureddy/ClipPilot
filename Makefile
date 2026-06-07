# ClipPilot dev shortcuts. Discovery works with no keys; moment detection needs OPENAI_API_KEY.
.PHONY: help redis engine orchestrator performance chat dashboard test demo down

help:
	@echo "make redis         # start redis-stack (vector search)"
	@echo "make engine        # Lane C  -> :8001 (real transcript + GPT moments)"
	@echo "make orchestrator  # Lane A  -> :8000 (real yt-dlp discovery)"
	@echo "make performance   # Lane B  (real metrics + learning loop)"
	@echo "make chat          # Team chat (agent Slack) — peer conversation worker"
	@echo "make dashboard     # Lane D  -> :3000"
	@echo "make test          # run offline test suite"
	@echo "make demo          # one autonomous cycle via the control API"
	@echo "make down          # stop redis"

redis:
	docker run -d --name clippilot-redis -p 6379:6379 redis/redis-stack:latest || docker start clippilot-redis

engine:
	uvicorn engine.app:app --port 8001 --reload

orchestrator:
	uvicorn discovery_orchestrator.app:app --port 8000 --reload

performance:
	python -m performance.worker --loop

chat:
	python -m agent_chat.worker --loop

dashboard:
	cd dashboard && npm run dev

test:
	python -m pytest

demo:
	@echo "Triggering one autonomous cycle..."
	curl -s -X POST localhost:8000/run-once | python -m json.tool
	@echo "\nStatus:"
	curl -s localhost:8000/status | python -m json.tool

down:
	docker rm -f clippilot-redis || true
