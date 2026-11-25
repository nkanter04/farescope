/**
 * After a deploy, the previous build's files are gone (Cloudflare serves only the current version),
 * so a tab opened earlier fails the first time it loads something on demand: the map, the
 * dashboard, the sign-in code, a theme. Reloading once picks up the new build. A short guard stops a
 * reload loop if the file is missing for another reason (offline, a broken deploy).
 */
const KEY = "tripica.reloadedForNewBuild";
const GUARD_MS = 60_000;

/** Reloads the page unless it already did so in the last minute. Returns false if it didn't. */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < GUARD_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Vite reports a failed on-demand import with this event (both modules and their preloads). */
export function watchForNewBuild() {
  window.addEventListener("vite:preloadError", (event) => {
    if (reloadForNewBuild()) event.preventDefault();
  });
}

/** Wraps an on-demand import so a missing file triggers the one-time reload. */
export function importOrReload<T>(load: () => Promise<T>): () => Promise<T> {
  return () => load().catch((error: unknown) => {
    if (reloadForNewBuild()) return new Promise<T>(() => undefined); // the page is reloading
    throw error;
  });
}
