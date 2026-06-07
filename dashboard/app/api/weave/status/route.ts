// Weave / Weights & Biases observability status for the dashboard.
// The Next server can't see the Python engine's process env, so we detect config by
// reading the project root .env (and falling back to the dashboard's own env). This lets
// the UI vividly show whether AI tracing is wired without the engine having to be running.
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readRootEnv(): Promise<Record<string, string>> {
  const candidates = [
    path.join(process.cwd(), "..", ".env"),
    path.join(process.cwd(), ".env"),
  ];
  for (const p of candidates) {
    try {
      const txt = await fs.readFile(p, "utf8");
      const out: Record<string, string> = {};
      for (const line of txt.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
      }
      return out;
    } catch {
      /* try next candidate */
    }
  }
  return {};
}

export async function GET() {
  const env = await readRootEnv();
  const pick = (k: string) => (process.env[k] || env[k] || "").trim();

  const key = pick("WEAVE_API_KEY") || pick("WANDB_API_KEY");
  const project = pick("WEAVE_PROJECT") || "clippilot";
  const entity = pick("WANDB_ENTITY") || pick("WEAVE_ENTITY");
  const enabled = key.length > 0;

  const dashboardUrl = entity
    ? `https://wandb.ai/${entity}/${project}/weave`
    : "https://wandb.ai/home";

  return Response.json({
    enabled,
    project,
    entity: entity || null,
    model: pick("OPENAI_MODEL") || "gpt-5.5",
    dashboardUrl,
    tracedOps: [
      {
        name: "detect_moments",
        desc: "GPT viral-moment scoring over each transcript window",
      },
      {
        name: "engine.process",
        desc: "full clip job: ingest → transcript → score → rank",
      },
    ],
  });
}
