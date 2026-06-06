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
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = body.action as string;
  const route = MAP[action];
  if (!route) return Response.json({ error: `unknown action ${action}` }, { status: 400 });

  try {
    const res = await fetch(`${DISCOVERY_API_URL}${route.path}`, {
      method: route.method,
      headers: { "content-type": "application/json" },
      body: route.method === "POST" ? JSON.stringify(body.payload ?? {}) : undefined,
      cache: "no-store",
    });
    const data = await res.json();
    return Response.json(data, { status: res.status });
  } catch (e) {
    return Response.json(
      { error: `Lane A unreachable at ${DISCOVERY_API_URL}: ${String(e)}` },
      { status: 502 },
    );
  }
}

export async function GET() {
  try {
    const res = await fetch(`${DISCOVERY_API_URL}/status`, { cache: "no-store" });
    return Response.json(await res.json(), { status: res.status });
  } catch (e) {
    return Response.json({ error: String(e), running: false }, { status: 502 });
  }
}
