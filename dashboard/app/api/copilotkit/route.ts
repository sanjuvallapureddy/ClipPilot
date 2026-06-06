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
const serviceAdapter = new OpenAIAdapter({
  openai,
  model: process.env.OPENAI_MODEL || "gpt-5.5",
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

export const POST = async (req: Request) => {
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: copilotKit,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });
  return handleRequest(req);
};
