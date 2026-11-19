import type { Context, Hono } from "hono";

/**
 * Bot check for routes that can spend live quota, using Cloudflare Turnstile (free).
 * The browser solves a Turnstile challenge once and trades the token for a pass: an HMAC of the
 * visitor's IP and today's date, signed with the Turnstile secret. Live routes then only check
 * the pass (no network call), and it expires at midnight UTC. Standard Web APIs only.
 */
export const PASS_HEADER = "x-tripica-pass";
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export interface TurnstileGate {
  /** Live-route guard: undefined when the pass is valid, else a 403 asking for a check. */
  check(c: Context): Promise<Response | undefined>;
  passFor(ip: string, day: string): Promise<string>;
  verify(token: string, ip: string): Promise<boolean>;
  ipOf(c: Context): string;
}

export function turnstileGate(
  secret: string,
  opts: { fetchImpl?: typeof fetch; today?: () => string; ipOf?: (c: Context) => string } = {},
): TurnstileGate {
  const f = opts.fetchImpl ?? fetch;
  const today = opts.today ?? (() => new Date().toISOString().slice(0, 10));
  const ipOf = opts.ipOf ?? ((c: Context) => c.req.header("cf-connecting-ip") ?? "unknown");
  let key: Promise<CryptoKey> | undefined;
  const hmacKey = () =>
    (key ??= crypto.subtle.importKey("raw", new TextEncoder().encode(`tripica-pass:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]));

  const gate: TurnstileGate = {
    ipOf,
    async passFor(ip, day) {
      const sig = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(`${ip}|${day}`));
      return `${day}.${b64url(sig)}`;
    },
    async check(c) {
      const pass = c.req.header(PASS_HEADER) ?? "";
      const day = today();
      if (pass && pass === (await gate.passFor(ipOf(c), day))) return undefined;
      return c.json({ error: "Please confirm you're not a robot to see live prices.", needsCheck: true }, 403);
    },
    async verify(token, ip) {
      const form = new URLSearchParams({ secret, response: token });
      if (ip && ip !== "unknown") form.set("remoteip", ip);
      const res = await f(VERIFY_URL, { method: "POST", body: form }).catch(() => undefined);
      const json = (await res?.json().catch(() => undefined)) as { success?: boolean } | undefined;
      return json?.success === true;
    },
  };
  return gate;
}

/** POST /api/human {token} → {pass}: trade a solved Turnstile challenge for today's pass. */
export function turnstileRoutes(app: Hono, gate: TurnstileGate): void {
  app.post("/api/human", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { token?: unknown };
    const token = typeof body.token === "string" && body.token.length < 4096 ? body.token : "";
    const ip = gate.ipOf(c);
    if (!token || !(await gate.verify(token, ip))) return c.json({ error: "The robot check failed. Please try again." }, 403);
    return c.json({ pass: await gate.passFor(ip, new Date().toISOString().slice(0, 10)) });
  });
}
