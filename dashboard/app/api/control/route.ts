// Control bridge: proxy dashboard/copilot actions to Lane A's control API.
import { DISCOVERY_API_URL } from "@/lib/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAP: Record<string, { method: string; path: string }> = {
  status: { method: "GET", path: "/status" },
  "run-once": { method: "POST", path: "/run-once" },
  start: { method: "POST", path: "/start" },
  stop: { method: "POST", path: "/stop" },
  discover: { method: "POST", path: "/discover" },
  research: { method: "POST", path: "/research" },
};

const LANE_A_HINT =
  "Start Lane A: uvicorn discovery_orchestrator.app:app --port 8000 (Redis must be on localhost:6379)";

async function fetchLaneA(path: string, init?: RequestInit) {
  return fetch(`${DISCOVERY_API_URL}${path}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(4000),
    ...init,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = body.action as string;
  const route = MAP[action];
  if (!route) return Response.json({ error: `unknown action ${action}` }, { status: 400 });

  try {
    const res = await fetchLaneA(route.path, {
      method: route.method,
      headers: { "content-type": "application/json" },
      body: route.method === "POST" ? JSON.stringify(body.payload ?? {}) : undefined,
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (e) {
    return Response.json(
      { error: `Lane A unreachable at ${DISCOVERY_API_URL}: ${String(e)}`, hint: LANE_A_HINT },
      { status: 502 },
    );
  }
}

export async function GET() {
  try {
    const healthRes = await fetchLaneA("/health");
    if (!healthRes.ok) {
      return Response.json(
        { error: "Lane A health check failed", running: false, hint: LANE_A_HINT },
        { status: 502 },
      );
    }
    try {
      const statusRes = await fetchLaneA("/status");
      if (statusRes.ok) {
        return Response.json(await statusRes.json());
      }
    } catch {
      // Lane A is up but /status failed (often Redis offline).
    }
    return Response.json({
      running: false,
      redis_ok: false,
      hint: "Lane A is up but Redis is unreachable. Start Redis on localhost:6379.",
    });
  } catch (e) {
    return Response.json(
      { error: String(e), running: false, hint: LANE_A_HINT },
      { status: 502 },
    );
  }
}
