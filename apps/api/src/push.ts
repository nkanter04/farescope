/**
 * Web Push without a payload: Tripica sends an empty push (only VAPID authentication, no
 * encryption needed), and the app's service worker fetches the alert text from /api/push/inbox.
 * Runs on Cloudflare Workers and Node 22 (Web Crypto only, no Node imports).
 */
/** The fields of a P-256 JWK we use (the DOM's JsonWebKey type isn't in every runtime's typings). */
export interface EcJwk { kty?: string; crv?: string; d?: string; x?: string; y?: string; [key: string]: unknown }

export interface Vapid {
  /** P-256 private key as a JWK (d, x, y). Secret: VAPID_PRIVATE_JWK. */
  jwk: EcJwk;
  /** Contact for push services, e.g. "mailto:tripica.help@gmail.com". */
  subject: string;
}

const enc = (s: string) => new TextEncoder().encode(s);
export const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** Parses the VAPID_PRIVATE_JWK secret; undefined if it isn't a P-256 private key. */
export function parseVapid(json: string | undefined, subject: string | undefined): Vapid | undefined {
  if (!json) return undefined;
  try {
    const jwk = JSON.parse(json) as EcJwk;
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.x || !jwk.y) return undefined;
    return { jwk, subject: subject || "mailto:tripica.help@gmail.com" };
  } catch {
    return undefined;
  }
}

/** The public key browsers subscribe with (uncompressed point, base64url). */
export function vapidPublicKey(v: Vapid): string {
  const x = fromB64url(v.jwk.x!);
  const y = fromB64url(v.jwk.y!);
  const out = new Uint8Array(65);
  out[0] = 4;
  out.set(x, 1);
  out.set(y, 33);
  return b64url(out);
}

/**
 * Only real browser push services may be stored: the alert job POSTs to these URLs, so anything
 * else could turn Tripica into a request relay.
 */
const PUSH_HOSTS = [/(^|\.)fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
export function isPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && endpoint.length <= 1000 && PUSH_HOSTS.some((h) => h.test(u.hostname));
  } catch {
    return false;
  }
}

export async function vapidHeaders(endpoint: string, v: Vapid, now = new Date()): Promise<Record<string, string>> {
  const jwk = { ...v.jwk, key_ops: ["sign"], ext: true } as unknown as Parameters<typeof crypto.subtle.importKey>[1];
  const key = await crypto.subtle.importKey("jwk", jwk as never, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = b64url(enc(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: v.subject })));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc(`${header}.${claims}`));
  return { Authorization: `vapid t=${header}.${claims}.${b64url(signature)}, k=${vapidPublicKey(v)}`, TTL: "604800", Urgency: "normal" };
}

/** Sends an empty push. "gone" means the browser unsubscribed: forget the endpoint. */
export async function sendPush(endpoint: string, v: Vapid, fetchImpl: typeof fetch = fetch): Promise<"ok" | "gone" | "failed"> {
  try {
    const res = await fetchImpl(endpoint, { method: "POST", headers: { ...(await vapidHeaders(endpoint, v)), "Content-Length": "0" } });
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "ok" : "failed";
  } catch {
    return "failed";
  }
}
