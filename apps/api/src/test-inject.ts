import type { Hono } from "hono";

/** Test helper: call a Hono app like Fastify's `inject`, so route tests stay short. */
export async function inject(
  app: Hono,
  opts: string | { method?: string; url: string; headers?: Record<string, string>; payload?: unknown },
) {
  const o = typeof opts === "string" ? { url: opts } : opts;
  const headers: Record<string, string> = { ...o.headers };
  if (o.payload !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(o.url, {
    method: o.method ?? "GET",
    headers,
    body: o.payload === undefined ? undefined : JSON.stringify(o.payload),
  });
  const body = await res.text();
  return {
    statusCode: res.status,
    headers: Object.fromEntries(res.headers.entries()),
    body,
    json: () => JSON.parse(body),
  };
}
