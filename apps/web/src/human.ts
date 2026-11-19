/**
 * Bot check (Cloudflare Turnstile) before routes that can spend live searches. Only active when
 * the build sets VITE_TURNSTILE_SITE_KEY (public). The solved challenge is traded for a pass that
 * the server accepts until midnight UTC; it is kept in localStorage and sent as a header.
 */
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const PASS_KEY = "tripica.pass";
export const PASS_HEADER = "x-tripica-pass";

interface TurnstileApi {
  render(el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "error-callback"?: () => void; appearance?: string }): string;
  remove(id: string): void;
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

const today = () => new Date().toISOString().slice(0, 10);

export function storedPass(): string | undefined {
  try {
    const pass = localStorage.getItem(PASS_KEY) ?? undefined;
    return pass?.startsWith(`${today()}.`) ? pass : undefined;
  } catch {
    return memoryPass?.startsWith(`${today()}.`) ? memoryPass : undefined;
  }
}
let memoryPass: string | undefined;
function savePass(pass: string | undefined) {
  memoryPass = pass;
  try {
    if (pass) localStorage.setItem(PASS_KEY, pass);
    else localStorage.removeItem(PASS_KEY);
  } catch {
    /* private mode: memory only */
  }
}

let script: Promise<TurnstileApi> | undefined;
function loadTurnstile(): Promise<TurnstileApi> {
  script ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("Turnstile did not load")));
    s.onerror = () => {
      script = undefined;
      reject(new Error("Could not load the robot check."));
    };
    document.head.appendChild(s);
  });
  return script;
}

let pending: Promise<string | undefined> | undefined;

/** A valid pass for today, running the check if needed. Resolves undefined when checks are off. */
export function ensurePass(force = false): Promise<string | undefined> {
  if (!SITE_KEY) return Promise.resolve(undefined);
  if (!force) {
    const pass = storedPass();
    if (pass) return Promise.resolve(pass);
  } else {
    savePass(undefined);
  }
  pending ??= (async () => {
    const turnstile = await loadTurnstile();
    // Usually invisible; when Cloudflare wants a click, the box shows in the corner.
    const box = document.createElement("div");
    box.className = "human-check";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Robot check");
    document.body.appendChild(box);
    try {
      const token = await new Promise<string>((resolve, reject) => {
        const id = turnstile.render(box, {
          sitekey: SITE_KEY,
          appearance: "interaction-only",
          callback: (t) => { resolve(t); turnstile.remove(id); },
          "error-callback": () => reject(new Error("The robot check failed. Please try again.")),
        });
      });
      const res = await fetch("/api/human", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "The robot check failed.");
      const { pass } = (await res.json()) as { pass: string };
      savePass(pass);
      return pass;
    } finally {
      box.remove();
    }
  })().finally(() => {
    pending = undefined;
  });
  return pending;
}

/**
 * fetch() for routes that may spend live searches: adds the pass, and if the server asks for a
 * (new) check, runs it and retries once.
 */
export async function liveFetch(url: string, init: RequestInit & { headers: Record<string, string> }): Promise<Response> {
  const withPass = async (force: boolean) => {
    const pass = await ensurePass(force);
    return fetch(url, { ...init, headers: pass ? { ...init.headers, [PASS_HEADER]: pass } : init.headers });
  };
  const res = await withPass(false);
  if (res.status !== 403 || !SITE_KEY) return res;
  const body = (await res.clone().json().catch(() => ({}))) as { needsCheck?: boolean };
  return body.needsCheck ? withPass(true) : res;
}
