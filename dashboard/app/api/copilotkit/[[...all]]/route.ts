// CopilotKit runtime (AG-UI backend). Server-side actions the copilot can call;
// these drive Lane A and read the contract, returning data the UI renders generatively.
import {
  CopilotRuntime,
  OpenAIAdapter,
} from "@copilotkit/runtime";
import { createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";
import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import OpenAI from "openai";
import { DISCOVERY_API_URL } from "@/lib/redis";

export const runtime = "nodejs";

// Placeholder key keeps construction (and the build) from throwing when unset;
// real LLM calls require a valid OPENAI_API_KEY at runtime.
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "sk-missing" });

// Identity + behavior for the in-product copilot, injected SERVER-SIDE (see below for why).
// Without it, the chat model has no role and behaves like generic ChatGPT — answering with
// boilerplate code/tutorials ("just gives code") instead of OPERATING ClipPilot via its actions.
const COPILOT_INSTRUCTIONS = [
  "You are the ClipPilot mission-control copilot — the in-product assistant for ClipPilot,",
  "an autonomous agent that discovers trending podcasts, clips their most viral moments into",
  "vertical (9:16) shorts, auto-posts to TikTok/Instagram/YouTube, then measures performance",
  "and learns to improve. ClipPilot is already built and running; you OPERATE it for the user.",
  "",
  "How to behave:",
  "- Prefer ACTION over explanation. When the user wants to find, research, discover, clip, run,",
  "  analyze, score, start, or stop anything, CALL the matching action (discoverPodcasts,",
  "  researchTrends, runPipeline, showAnalytics, rateClipVirality, startAutonomous, stopAutonomous,",
  "  getStatus) instead of describing how to do it yourself.",
  "- NEVER output source code, code blocks, library lists, or step-by-step build tutorials.",
  "  You are not a coding assistant. If asked “how does this work?” or “how would I build this?”,",
  "  give a brief, plain-English explanation of what ClipPilot already does, then offer to run the",
  "  relevant action.",
  "- Keep replies concise and product-focused (usually one or two sentences). Use the live",
  "  orchestrator status and winning patterns provided to you as context.",
  "- If a request clearly maps to an action, just call it. If it is ambiguous, ask one short",
  "  clarifying question or suggest the closest action.",
].join("\n");

// WHY this is injected here instead of via the <CopilotSidebar instructions=…> prop:
// CopilotKit 1.59 routes chat through its v2 BuiltInAgent (AG-UI `agent/run`), which builds the
// LLM prompt from the Vercel AI SDK model returned by adapter.getLanguageModel(). The client
// `instructions` prop is NOT forwarded into that path (verified: it never appears in the request
// body), so the model ran with no system message at all. We wrap the language model with an AI SDK
// middleware that prepends our system message to the FINAL prompt — guaranteed to reach OpenAI
// regardless of how CopilotKit assembles the request.
const systemPromptMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",
  transformParams: async ({ params }) => {
    const prompt = params.prompt ?? [];
    const alreadyInjected = prompt.some(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.includes("ClipPilot mission-control copilot"),
    );
    if (alreadyInjected) return params;
    return {
      ...params,
      prompt: [{ role: "system", content: COPILOT_INSTRUCTIONS }, ...prompt],
    };
  },
};

// The copilot CHAT runs on a FAST, INSTRUCTION-FOLLOWING model, deliberately decoupled
// from OPENAI_MODEL (the heavy reasoning model the Python engine uses for moment
// detection). Heavy reasoning models (gpt-5.x, o-series) spend minutes on hidden
// reasoning before streaming any tokens — unusable for chat. But the other extreme
// (gpt-4o-mini) is too weak to reliably follow the copilot's system instructions:
// it ignores the registered actions and falls back to generic coding-assistant
// behavior ("just gives code"). gpt-4o is the sweet spot — sub-second to first token
// AND strong at tool-calling + instruction following. COPILOT_MODEL can override.
const serviceAdapter = new OpenAIAdapter({
  openai,
  model: process.env.COPILOT_MODEL || "gpt-4o",
  // Force sequential tool calls. Parallel tool calls race the AG-UI run lifecycle and
  // throw "Cannot send 'RUN_FINISHED' while tool calls are still active", which the browser
  // surfaces as agent_connect_failed / "Failed to fetch". Sequential calls also let each
  // action's state change (e.g. start loop -> status) be visible to the next one.
  disableParallelToolCalls: true,
});

// CopilotKit's v2 BuiltInAgent calls adapter.getLanguageModel() to build the prompt, so we
// override it to return a model wrapped with our system-prompt middleware. This is the single
// reliable hook for steering the copilot's behavior (the client `instructions` prop is dropped
// by the agent/run path — see systemPromptMiddleware above).
const baseGetLanguageModel = serviceAdapter.getLanguageModel.bind(serviceAdapter);
serviceAdapter.getLanguageModel = () =>
  wrapLanguageModel({
    // getLanguageModel() is typed as the broad `LanguageModel` union (which includes a bare
    // model-id string); at runtime it returns a concrete @ai-sdk/openai model instance, so we
    // narrow it to the exact type wrapLanguageModel expects.
    model: baseGetLanguageModel() as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: systemPromptMiddleware,
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

// Multi-route handler: serves GET /info (registers the default BuiltInAgent for
// CopilotKitCore's useAgent hook), POST /agent/:id/run, /threads, etc. The old
// single-route stub returned agents:{} which caused "Agent 'default' not found".
copilotKit.handleServiceAdapter(serviceAdapter);

const handler = createCopilotRuntimeHandler({
  runtime: copilotKit.instance,
  basePath: "/api/copilotkit",
  cors: true,
});

export const GET = handler;
export const POST = handler;
export const OPTIONS = handler;
