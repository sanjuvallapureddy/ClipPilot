// CopilotKit runtime (AG-UI backend). Server-side actions the copilot can call;
// these drive Lane A and read the contract, returning data the UI renders generatively.
import {
  CopilotRuntime,
  OpenAIAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import OpenAI from "openai";
import { DISCOVERY_API_URL } from "@/lib/redis";

export const runtime = "nodejs";

// Placeholder key keeps construction (and the build) from throwing when unset;
// real LLM calls require a valid OPENAI_API_KEY at runtime.
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "sk-missing" });

// The copilot CHAT runs on a FAST model, deliberately decoupled from OPENAI_MODEL
// (the heavy reasoning model the Python engine uses for moment detection). Heavy
// reasoning models spend a long time on hidden reasoning before streaming any
// tokens, which made even trivial chat/AG-UI turns take minutes. COPILOT_MODEL lets
// us pin a low-latency chat model here without affecting backend moment detection.
const serviceAdapter = new OpenAIAdapter({
  openai,
  model: process.env.COPILOT_MODEL || "gpt-4o-mini",
});

async function laneA(path: string, method = "POST", payload: unknown = {}) {
  const res = await fetch(`${DISCOVERY_API_URL}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "POST" ? JSON.stringify(payload) : undefined,
    cache: "no-store",
  });
  return res.json();
}

// Demo-facing actions (discoverPodcasts, runPipeline, showAnalytics) are registered
// CLIENT-side in app/page.tsx so they can render generative UI. These backend actions
// cover control + status the copilot may also call.
const copilotKit = new CopilotRuntime({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions: (): any[] => [
    {
      name: "startAutonomous",
      description:
        "Low-level start of the unattended autonomous loop on a topic (no confirmation). " +
        "Prefer the client action 'startAutonomousLoop', which asks the user to confirm first.",
      parameters: [
        { name: "topic", type: "string", required: true },
        { name: "interval_seconds", type: "number", required: false },
      ],
      handler: async (p: { topic: string; interval_seconds?: number }) =>
        laneA("/start", "POST", p),
    },
    {
      name: "stopAutonomous",
      description:
        "Stop the autonomous loop (low-level). The client action 'stopAutonomousLoop' is " +
        "equivalent and also refreshes the dashboard.",
      parameters: [],
      handler: async () => laneA("/stop", "POST", {}),
    },
    {
      name: "getStatus",
      description: "Get orchestrator status, queue depth, and current winning patterns.",
      parameters: [],
      handler: async () => laneA("/status", "GET"),
    },
  ],
});

// Classic GraphQL chat uses the single-route POST handler below.
const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  runtime: copilotKit,
  serviceAdapter,
  endpoint: "/api/copilotkit",
});

// @copilotkit/react-core 1.59 mounts CopilotKitCore alongside the classic chat client.
// On load it auto-detects transport by GET `${runtimeUrl}/info` (rest) or POST
// `{ method: "info" }` (single-route). The classic endpoint only handled GraphQL POST,
// so both probes 500'd → "Runtime info request failed with status 500" toast.
// Answer the probe ourselves with a valid v2-shaped payload; mode "sse" matches the
// classic runtime and keeps the GraphQL chat path working.
const RUNTIME_VERSION = "1.59.5";
function runtimeInfoResponse() {
  return Response.json({
    version: RUNTIME_VERSION,
    agents: {},
    mode: "sse",
    intelligence: null,
    audioFileTranscriptionEnabled: false,
    a2uiEnabled: false,
    openGenerativeUIEnabled: false,
    telemetryDisabled: process.env.COPILOTKIT_TELEMETRY_DISABLED === "true",
  });
}

async function isInfoProbe(req: Request): Promise<boolean> {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/info")) return true;
  if (req.method !== "POST") return false;
  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return false;
  try {
    const body = await req.clone().json();
    return body?.method === "info";
  } catch {
    return false;
  }
}

export const POST = async (req: Request) => {
  if (await isInfoProbe(req)) return runtimeInfoResponse();
  return handleRequest(req);
};

export const GET = async (req: Request) => {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/info")) return runtimeInfoResponse();
  // Chat-history probe — classic runtime has no persisted thread store.
  if (url.pathname.endsWith("/threads")) {
    const agentId = url.searchParams.get("agentId");
    if (!agentId) {
      return Response.json({ error: "Valid agentId query param is required" }, { status: 400 });
    }
    return Response.json({ threads: [], nextCursor: null });
  }
  return handleRequest(req);
};

export const OPTIONS = (req: Request) => handleRequest(req);
