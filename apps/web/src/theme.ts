import { useSyncExternalStore } from "react";

/**
 * Themes are plain CSS files in ./themes, injected at runtime (switchable with ?theme=<name>, or the
 * picker in dev when more than one exists). Unused drafts live in /design/theme-drafts. Each theme also sets a few --globe-* variables that the
 * WebGL globe reads, since canvas colors can't be styled with CSS.
 */
const loaders = import.meta.glob<string>("./themes/*.css", { query: "?inline", import: "default" });
const byName = Object.fromEntries(Object.entries(loaders).map(([path, load]) => [path.match(/([^/]+)\.css$/)![1], load]));

export const THEME_NAMES = Object.keys(byName).sort();
export const DEFAULT_THEME = "daylight";
const EVENT = "farescope-theme";

function initialTheme(): string {
  const fromUrl = new URLSearchParams(location.search).get("theme");
  if (fromUrl && byName[fromUrl]) return fromUrl;
  try {
    const saved = localStorage.getItem("farescope.theme");
    if (saved && byName[saved]) return saved;
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_THEME;
}

let current = "";

export async function applyTheme(name = initialTheme()): Promise<void> {
  const load = byName[name] ?? byName[DEFAULT_THEME];
  const css = await load();
  let tag = document.getElementById("theme-css") as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement("style");
    tag.id = "theme-css";
    document.head.appendChild(tag);
  }
  tag.textContent = css;
  current = name;
  document.documentElement.dataset.theme = name;
  try {
    localStorage.setItem("farescope.theme", name);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}

export function useThemeName(): string {
  return useSyncExternalStore(subscribe, () => current);
}

export interface GlobeTheme {
  texture: string;
  atmosphere: string;
  origin: string;
  label: string;
  mutedPoint: string;
  /** Multiplier for flight-arc thickness (light globes need thicker arcs). */
  arcScale: number;
}

const TEXTURES = new Set(["night", "dark", "day", "blue-marble"]);

/** Globe colors for the active theme, read from CSS custom properties on :root. */
export function useGlobeTheme(): GlobeTheme {
  const name = useThemeName();
  return readGlobeTheme(name);
}

const cache = new Map<string, GlobeTheme>();
function readGlobeTheme(name: string): GlobeTheme {
  const hit = cache.get(name);
  if (hit) return hit;
  const cs = getComputedStyle(document.documentElement);
  const v = (k: string, d: string) => cs.getPropertyValue(k).trim().replace(/^["']|["']$/g, "") || d;
  const texture = v("--globe-texture", "night");
  const t: GlobeTheme = {
    texture: TEXTURES.has(texture) ? texture : "night",
    atmosphere: v("--globe-atmosphere", "#5fa8ff"),
    origin: v("--globe-origin", "#7cc4ff"),
    label: v("--globe-label", "rgba(255,255,255,0.9)"),
    mutedPoint: v("--globe-muted-point", "rgba(255,255,255,0.35)"),
    arcScale: Number(v("--globe-arc-scale", "1")) || 1,
  };
  if (name) cache.set(name, t);
  return t;
}
