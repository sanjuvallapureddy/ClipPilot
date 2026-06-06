"""Lane C — viral-moment detection API (OpenShorts wrapper surface).

Contract (§4): POST /process {youtube_url, config} -> {job_id}; GET /status/{job_id}.
Runs the REAL pipeline: real transcript -> GPT moment detection. Video render + posting
need OpenShorts + platform credentials; results carry honest render/post status until then.
"""
from __future__ import annotations

import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from shared.redis_client import coord
from shared.schemas import EngineStatus, ProcessRequest, ProcessResponse

from . import pipeline

app = FastAPI(title="ClipPilot Engine", version="0.2.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


@app.on_event("startup")
async def _startup() -> None:
    coord("C", "milestone", "engine up (real transcript + GPT moment detection)")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "llm": bool(os.getenv("OPENAI_API_KEY"))}


@app.post("/process", response_model=ProcessResponse)
async def process(req: ProcessRequest) -> ProcessResponse:
    if not req.youtube_url:
        raise HTTPException(400, "youtube_url required")
    engine_job_id = pipeline.submit(req)
    return ProcessResponse(job_id=engine_job_id)


@app.get("/status/{job_id}", response_model=EngineStatus)
def status(job_id: str) -> EngineStatus:
    st = pipeline.get_status(job_id)
    if not st:
        raise HTTPException(404, f"unknown engine job {job_id}")
    return st
