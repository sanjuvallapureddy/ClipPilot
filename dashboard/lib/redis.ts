// Server-only Redis bridge for the dashboard (Lane D). Reads contract keys (§4).
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379/0";

let _client: Redis | null = null;
export function redis(): Redis {
  if (!_client) _client = new Redis(REDIS_URL, { maxRetriesPerRequest: 3 });
  return _client;
}

// A dedicated connection for blocking XREAD (SSE), so it doesn't stall the pool.
export function blockingRedis(): Redis {
  return new Redis(REDIS_URL);
}

export const DISCOVERY_API_URL =
  process.env.DISCOVERY_API_URL || "http://localhost:8000";

export const KEYS = {
  DISCOVERY_QUEUE: "discovery:queue",
  JOBS_STREAM: "jobs:stream",
  PATTERNS_CURRENT: "patterns:current",
  RESULTS_SET: "results:all",
} as const;

export const resultKey = (id: string) => `results:${id}`;
export const jobKey = (id: string) => `jobs:${id}`;

// Convert a flat XREAD field array [k1,v1,k2,v2,...] into an object.
export function fieldsToObj(fields: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) o[fields[i]] = fields[i + 1];
  return o;
}
