ClipPilot 🎬🤖
The Autonomous Multi-Agent Short-Form Video Factory
ClipPilot is a production-grade, zero-human-in-the-loop autonomous pipeline that orchestrates the entire lifecycle of viral content acquisition, refinement, generation, distribution, and performance optimization.

Instead of building a monolithic application or relying on manual video clipping workflows, ClipPilot implements a decoupled, event-driven mesh of four independent, specialized AI agents. The system constantly monitors cultural trends, ingests high-signal audio/video assets, parses raw conversational transcripts via semantic heuristics, predicts viral coefficient hooks, handles multi-platform distribution, and feeds real-time performance analytics back into the discovery engine to dynamically adjust target parameters for the next iteration loop.

Built in 24 hours at Fire Hacks by a 4-person elite engineering team.

🚀 Sponsor Integration & Tooling Stack
To deliver a production-ready infrastructure under extreme time-box constraints, the architectural design maximizes the leverage of high-end sponsor primitives across data persistence, real-time context streaming, AI abstraction, and developer velocity.

1. Redis (State Backbone, Pub/Sub, & Shared Contract)
Redis acts as the central central nervous system of ClipPilot. Given the async, multi-lane python microservice layout, we completely decoupled the execution tracks by enforcing a deterministic data contract through a Redis-Stack instance.

Message Broker: We leveraged Redis Pub/Sub to power the chat:stream channel, enabling real-time, peer-to-peer communication between agent personas (Scout, Cutter, Coach, Pilot) in the team workspace.

State Management & Queues: Ingestion sequences are tracked using Redis List primitives (discovery:queue). Individual processing pipelines are managed as atomic Redis Hashes (jobs:{id}), preventing race conditions among multiple workers. Analytical trends and historical vector adjustments are cached directly in key-value strings (patterns:current).

2. CopilotKit (Context-Aware Front-End AI Portal)
Instead of forcing users to rely on conventional button triggers to monitor or override autonomous processes, CopilotKit was integrated directly into our Next.js Vercel/Linear-inspired front-end layout.

In-App Cloud Copilot: CopilotKit wraps the frontend context, allowing the user to seamlessly interact with the multi-agent backend using natural language commands (e.g., "Find trending tech podcasts and clip the most controversial moments").

State Hydration: It continuously maps real-time data from the underlying Redis stream into actionable front-end components, giving the human controller intuitive co-navigation capabilities over an otherwise completely autonomous system.

3. Cursor (Rapid Multithreading Development Environment)
Building a 4-lane asynchronous application layout with a unified data schema within 24 hours requires massive developer velocity. Cursor (Pro Plan features) was utilized to eliminate context-switching overhead and scaffold the infrastructure.

Cursor Composer: Used to simultaneously rewrite and manage files across the backend FastAPI lanes, python worker pools, and the frontend React framework without breaking the shared structural type definition boundaries (shared/).

Multi-File Context Aggregation: Allowed our team to instantly refactor the entire application visual structure from a generic, gradient-heavy dashboard layout into an ultra-clean, high-density, true-black appearance inspired by premium developer platforms.

4. OpenAI (Intellectual Layer & Agent Personality Profiles)
OpenAI's underlying models drive both the qualitative logic and the collaboration layers within the application.

Semantic Analysis & Hook Evaluation: Real-time transcripts pulled by our workers are evaluated via structured GPT-4o-mini prompts to score hooks, define start/end timestamps, and extract optimal 9:16 portrait composition frames based on calculated high-engagement quotes.

Agent "Slack" Persona Workspace: Each system lane is assigned a highly specialized OpenAI system prompt, enabling them to chat as peer teammates inside the workspace console, analyzing pipeline logs and making collaborative execution decisions without a rigid orchestrator.

5. Upload-Post (Target Distribution Gateway)
Upload-Post provides the critical programmatic egress layer for ClipPilot's output assets. Once a video clip finishes compilation, it hits the Upload-Post API endpoints, abstracting away complex multi-platform authentication tokens, rate-limiting rules, and metadata requirements for rapid scheduling across TikTok, Instagram Reels, and YouTube Shorts.

6. OpenShorts (The Video Render & Composition Core)
ClipPilot handles the autonomy layer, while OpenShorts serves as our concrete underlying rendering architecture. The backend engine wraps the open-source OpenShorts rendering interface, firing structured POST /process payloads containing our extracted GPT timestamps, asset URLs, and crop parameters to execute hardware-accelerated video composition and overlay placement.

🧬 Architectural Topology
ClipPilot is split into four isolated, asynchronous lanes that maintain isolation and interact exclusively through the Redis Contract Layer or explicit third-party API networks.

┌─────────────────────────────────────────────────────────────────────────┐
│                                 LANE D                                  │
│             dashboard/ Next.js UI + CopilotKit Mission Control          │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ (Reads/Writes)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          REDIS CONTRACT LAYER                           │
│        Shared/ Data Keys (`shared/keys.py`, `schemas.py`, `types.ts`)     │
│  [Data Flow]: discovery:queue ──► jobs:{id} ──► patterns:current        │
└──────┬─────────────────────────────┬─────────────────────────────┬──────┘
       │                             │                             │
       ▼                             ▼                             ▼
┌──────────────┐              ┌──────────────┐              ┌──────────────┐
│    LANE A    │              │    LANE B    │              │    LANE C    │
│  discovery-  │              │ performance/ │              │   engine/    │
│ orchestrator │              │ Metric Logs, │              │ OpenShorts   │
│ Trending API │              │ Pattern Logs │              │ Video Engine │
│  & Ingestion │              │  & Learning  │              │ API Wrapper  │
└──────────────┘              └──────────────┘              └──────────────┘
Lane Layout Breakdowns
Lane A — discovery-orchestrator/: A FastAPI worker cluster tasked with scanning public platforms for trending long-form podcasts, computing engagement velocities, and pushing high-signal links into the central execution stack.

Lane B — performance/: An analytical monitoring worker that captures raw performance telemetry from active distribution channels, runs comparative A/B variant indexing, and mutates target selection patterns.

Lane C — engine/: The programmatic video rendering driver acting as an optimized wrapper around the OpenShorts engine infrastructure.

Lane D — dashboard/: A premium, low-friction developer workstation tracking interface built using Next.js, Tailwind CSS, and CopilotKit.

agent_chat/: A simulated operational chat engine mapping background pipelines into clear conversational logs where all 4 agents coordinate work in distinct communication channels.

📊 Technical Implementation Detail: Production Logs over Fake Data
ClipPilot is architected on deterministic, live execution paths. There are no static JSON mocks or artificial data pipelines:

Live Discovery Extraction: Employs an optimized yt-dlp integration to directly query real-time platform search metrics, capturing genuine titles, precise views, and cultural metadata arrays without requiring brittle developer API credentials.

Transparent Pipeline Status Indicators: Video rendering (render_status) and channel distributions (post_status) map their direct upstream API conditions accurately. If an endpoint is unlinked, status bars clearly declare a state of pending or not_posted with exact numerical readouts remaining at absolute zero until verified values return from external trackers.

🛠️ Quick Start & Local Setup
System Prerequisites
Ensure you have Python 3.10+, Node.js 18+, and Docker Desktop installed locally.

Bash
# 1. Clone the repository and configure your operational environment tokens
cp .env.example .env

# 2. Spin up the localized Redis Stack cluster via Docker
docker run -d --name clippilot-redis -p 6379:6379 redis/redis-stack:latest

# 3. Initialize your python virtual isolation environment and build project dependencies
python -m venv .venv
source .venv/bin/activate  # On Windows use: .venv\Scripts\activate
pip install -r requirements.txt

# 4. Boot up the asynchronous microservice lanes via concurrent terminal streams
uvicorn engine.app:app --port 8001                        # Boot Lane C (Video Engine Link)
uvicorn discovery_orchestrator.app:app --port 8000        # Boot Lane A (Discovery Track)
python -m performance.worker --loop                       # Active Lane B (Telemetry Worker)
python -m agent_chat.worker --loop                        # Active Agent Workspace Workspace Logs

# 5. Compile and launch the high-density frontend workstation
cd dashboard
npm install
npm run dev
Navigate to http://localhost:3000 to interact with your local instance.

Triggering a Test Cycle
To bypass the automatic background timers and manually fire a targeted extraction sequence, hit the ingestion router with a cURL payload:

Bash
curl -X POST localhost:8000/run-once -H 'content-type: application/json' -d '{"topic":"artific
