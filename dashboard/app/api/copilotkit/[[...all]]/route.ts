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
      description: "Start the unattended autonomous loop on a topic.",
      parameters: [
        { name: "topic", type: "string", required: true },
        { name: "interval_seconds", type: "number", required: false },
      ],
      handler: async (p: { topic: string; interval_seconds?: number }) =>
        laneA("/start", "POST", p),
    },
    {
      name: "stopAutonomous",
      description: "Stop the autonomous loop.",
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

// The Next.js App Router helper mounts a SINGLE-ROUTE (POST-only, JSON-RPC) endpoint:
// the chat/AG-UI client POSTs to /api/copilotkit and the handler dispatches by body.
const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  runtime: copilotKit,
  serviceAdapter,
  endpoint: "/api/copilotkit",
});

// Why a catch-all ([[...all]]) instead of a flat route.ts:
// the v1.59 @copilotkit/react-ui ALSO issues a REST-style GET /api/copilotkit/threads
// for chat-history. The old POST-only route.ts didn't match that sub-path at all, so it
// 404'd in the console. This optional catch-all matches the base AND every sub-path.
//
// This runtime is the classic CopilotRuntime (no CopilotKitIntelligence / thread store),
// so the library's own list-threads handler would return 422 here — there's simply no
// persisted history to serve. We answer the UI's history probe with a valid, empty
// thread list (mirroring the runtime's { threads, nextCursor } shape) so it resolves
// cleanly (200) instead of erroring. The chat itself is unaffected (it uses POST).
export const POST = (req: Request) => handleRequest(req);

export const GET = (req: Request) => {
  const url = new URL(req.url);
  if (url.pathname.endsWith("/threads")) {
    const agentId = url.searchParams.get("agentId");
    if (!agentId) {
      return Response.json({ error: "Valid agentId query param is required" }, { status: 400 });
    }
    return Response.json({ threads: [], nextCursor: null });
  }
  // Other GET sub-routes (e.g. /info) fall through to the runtime, which returns a
  // clean handled JSON response rather than a Next.js 404.
  return handleRequest(req);
};

export const OPTIONS = (req: Request) => handleRequest(req);
