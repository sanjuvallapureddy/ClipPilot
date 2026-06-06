# ClipPilot dev shortcuts. MOCK/simulate modes need zero external keys.
.PHONY: help redis seed engine orchestrator performance dashboard test demo down

help:
	@echo "make redis         # start redis-stack (vector search)"
	@echo "make seed          # seed every Redis key with stub data"
	@echo "make engine        # Lane C  -> :8001"
	@echo "make orchestrator  # Lane A  -> :8000"
	@echo "make performance   # Lane B  (simulate + loop)"
	@echo "make dashboard     # Lane D  -> :3000"
	@echo "make test          # run offline test suite"
	@echo "make demo          # one autonomous cycle via the control API"
	@echo "make down          # stop redis"

redis:
	docker run -d --name clippilot-redis -p 6379:6379 redis/redis-stack:latest || docker start clippilot-redis

seed:
	python -m shared.stubs --all

engine:
	uvicorn engine.app:app --port 8001 --reload

orchestrator:
	uvicorn discovery_orchestrator.app:app --port 8000 --reload

performance:
	python -m performance.worker --simulate --loop

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
