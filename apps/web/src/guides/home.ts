/**
 * Homepage animation (bundled by the guides build into /home.js). It does three things, all
 * illustrations with no prices:
 * - a dotted globe where flights fan out from one city and the cheaper picks glow green,
 * - a search grid that fills in every departure day × trip length and pins the cheapest,
 * - a counter and dot field showing how many trips one search compares.
 * The page renders a complete static version first; this only animates it. It respects
 * prefers-reduced-motion and pauses offscreen.
 */
import LAND from "./land-dots.json";
import { cellLabel, cheapestCell, gridCells, gridMonths, shade, type GridCell } from "./home-grid.ts";
import type { HomeScene, ScenePoint } from "./home-scenes.ts";

const scenesEl = document.getElementById("home-scenes");
const SCENES: HomeScene[] = scenesEl ? (JSON.parse(scenesEl.textContent ?? "[]") as HomeScene[]) : [];
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const SCENE_MS = 9500;
const RAD = Math.PI / 180;
const fmt = (n: number) => n.toLocaleString("en-US");
const css = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

// ---------------------------------------------------------------- globe

type Vec = [number, number, number];
const toVec = (lon: number, lat: number): Vec => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
const toLonLat = (v: Vec): [number, number] => [Math.atan2(v[1], v[0]) / RAD, Math.asin(Math.max(-1, Math.min(1, v[2] / Math.hypot(...v)))) / RAD];

function slerp(a: Vec, b: Vec, t: number): Vec {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const w = Math.acos(dot);
  if (w < 1e-6) return a;
  const s = Math.sin(w);
  const ka = Math.sin((1 - t) * w) / s;
  const kb = Math.sin(t * w) / s;
  return [ka * a[0] + kb * b[0], ka * a[1] + kb * b[1], ka * a[2] + kb * b[2]];
}

/** Where to point the globe for a scene: between the origin and its destinations. */
function sceneCenter(s: HomeScene): [number, number] {
  const vs = [toVec(s.origin.lon, s.origin.lat), ...s.dests.map((d) => toVec(d.lon, d.lat))];
  const o = toVec(s.origin.lon, s.origin.lat);
  const sum = vs.reduce<Vec>((m, v) => [m[0] + v[0], m[1] + v[1], m[2] + v[2]], [0, 0, 0]);
  // Weight the origin so it stays on screen.
  const c: Vec = [sum[0] + o[0] * vs.length * 0.6, sum[1] + o[1] * vs.length * 0.6, sum[2] + o[2] * vs.length * 0.6];
  const [lon, lat] = toLonLat(c);
  return [lon, Math.max(-5, Math.min(38, lat))];
}

function createGlobe(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return undefined;
  const accent = css("--accent", "#1570e8");
  const green = "#16a34a";
  let size = 0;
  let dpr = 1;
  let center: [number, number] = SCENES[0] ? sceneCenter(SCENES[0]) : [0, 20];
  let from = center;
  let to = center;
  let moveStart = 0;
  let scene = SCENES[0];
  let sceneStart = performance.now();

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect();
    size = Math.max(1, Math.round(r.width));
    canvas.width = size * dpr;
    canvas.height = size * dpr;
  }

  function setScene(s: HomeScene, now: number) {
    scene = s;
    sceneStart = now;
    from = center;
    to = sceneCenter(s);
    moveStart = now;
  }

  function draw(now: number) {
    if (!ctx || !scene) return;
    const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
    const mt = reduced ? 1 : Math.min(1, (now - moveStart) / 1400);
    // Shortest way round in longitude.
    let dLon = to[0] - from[0];
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const drift = reduced ? 0 : Math.sin(now / 5200) * 7;
    center = [from[0] + dLon * ease(mt), from[1] + (to[1] - from[1]) * ease(mt)];
    const lam0 = (center[0] + drift) * RAD;
    const phi0 = center[1] * RAD;
    const sinP0 = Math.sin(phi0);
    const cosP0 = Math.cos(phi0);

    const W = size * dpr;
    const R = W * 0.4;
    const cx = W / 2;
    const cy = W / 2;
    ctx.clearRect(0, 0, W, W);

    // Atmosphere and sphere.
    const glow = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.22);
    glow.addColorStop(0, "rgba(21,112,232,0.16)");
    glow.addColorStop(1, "rgba(21,112,232,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.22, 0, Math.PI * 2); ctx.fill();
    const sphere = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    sphere.addColorStop(0, "#ffffff");
    sphere.addColorStop(1, "#dce8f8");
    ctx.fillStyle = sphere;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    /** Orthographic projection of a (possibly lifted) point: screen x, y and depth z. */
    const project = (lon: number, lat: number, r = 1): [number, number, number] => {
      const l = lon * RAD - lam0;
      const p = lat * RAD;
      const cosP = Math.cos(p);
      const x = r * cosP * Math.sin(l);
      const y = r * (cosP0 * Math.sin(p) - sinP0 * cosP * Math.cos(l));
      const z = r * (sinP0 * Math.sin(p) + cosP0 * cosP * Math.cos(l));
      return [cx + R * x, cy - R * y, z];
    };

    // Land dots, darker toward the middle for depth.
    const dot = Math.max(1, R / 200) * dpr * 0.75;
    for (let i = 0; i < LAND.length; i += 2) {
      const [x, y, z] = project(LAND[i], LAND[i + 1]);
      if (z <= 0) continue;
      ctx.fillStyle = `rgba(30, 64, 120, ${0.22 + 0.5 * z})`;
      ctx.beginPath(); ctx.arc(x, y, dot, 0, Math.PI * 2); ctx.fill();
    }

    // Flight arcs, one after another; cheaper ones in green with a dot travelling along them.
    const t = reduced ? 1e9 : now - sceneStart;
    const o = toVec(scene.origin.lon, scene.origin.lat);
    const labels: [number, number, string][] = [];
    scene.dests.forEach((d: ScenePoint, k) => {
      const p = Math.min(1, Math.max(0, (t - 350 - k * 140) / 900));
      if (p <= 0) return;
      const b = toVec(d.lon, d.lat);
      const dist = Math.acos(Math.max(-1, Math.min(1, o[0] * b[0] + o[1] * b[1] + o[2] * b[2])));
      const lift = 0.05 + 0.22 * (dist / Math.PI);
      const steps = 56;
      ctx.beginPath();
      let pen = false;
      let tip: [number, number] | undefined;
      for (let i = 0; i <= Math.ceil(steps * p); i++) {
        const u = Math.min(p, i / steps);
        const [lon, lat] = toLonLat(slerp(o, b, u));
        const [x, y, z] = project(lon, lat, 1 + lift * Math.sin(Math.PI * u));
        const visible = z > 0 || Math.hypot(x - cx, y - cy) > R;
        if (visible) { if (pen) ctx.lineTo(x, y); else ctx.moveTo(x, y); pen = true; tip = [x, y]; } else pen = false;
      }
      ctx.lineWidth = (d.cheap ? 2.4 : 1.3) * dpr;
      ctx.strokeStyle = d.cheap ? green : "rgba(21,112,232,0.5)";
      ctx.shadowColor = d.cheap ? "rgba(22,163,74,0.55)" : "transparent";
      ctx.shadowBlur = d.cheap ? 8 * dpr : 0;
      ctx.stroke();
      ctx.shadowBlur = 0;
      const [ex, ey, ez] = project(d.lon, d.lat);
      if (p >= 1 && ez > 0) {
        ctx.fillStyle = d.cheap ? green : accent;
        ctx.beginPath(); ctx.arc(ex, ey, (d.cheap ? 3.6 : 2.4) * dpr, 0, Math.PI * 2); ctx.fill();
        if (d.cheap) labels.push([ex, ey, d.name]);
      }
      if (d.cheap && p >= 1 && !reduced) {
        const u = ((now / 2400 + k * 0.37) % 1);
        const [lon, lat] = toLonLat(slerp(o, b, u));
        const [x, y, z] = project(lon, lat, 1 + lift * Math.sin(Math.PI * u));
        if (z > 0 || Math.hypot(x - cx, y - cy) > R) {
          ctx.fillStyle = "#ffffff";
          ctx.strokeStyle = green;
          ctx.lineWidth = 1.5 * dpr;
          ctx.beginPath(); ctx.arc(x, y, 3 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      } else if (tip && p < 1) {
        ctx.fillStyle = d.cheap ? green : accent;
        ctx.beginPath(); ctx.arc(tip[0], tip[1], 2 * dpr, 0, Math.PI * 2); ctx.fill();
      }
    });

    // Origin with a soft pulse.
    const [ox, oy, oz] = project(scene.origin.lon, scene.origin.lat);
    if (oz > 0) {
      const pulse = reduced ? 0.5 : (now / 1600) % 1;
      ctx.strokeStyle = `rgba(21,112,232,${0.5 * (1 - pulse)})`;
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(ox, oy, (5 + 14 * pulse) * dpr, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(ox, oy, 5 * dpr, 0, Math.PI * 2); ctx.fill();
      labels.push([ox, oy, scene.origin.name]);
    }
    // City labels only when there's room.
    if (size >= 300) {
      ctx.font = `600 ${12 * dpr}px Inter, system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      for (const [x, y, name] of labels) {
        const w = ctx.measureText(name).width + 12 * dpr;
        const lx = Math.min(W - w - 4, x + 8 * dpr);
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.beginPath(); ctx.roundRect(lx, y - 10 * dpr, w, 20 * dpr, 6 * dpr); ctx.fill();
        ctx.fillStyle = "#17233a";
        ctx.fillText(name, lx + 6 * dpr, y);
      }
    }
  }

  resize();
  new ResizeObserver(resize).observe(canvas);
  return { draw, setScene };
}

// ---------------------------------------------------------------- search grid + counter

function createSweep(root: HTMLElement) {
  const gridEl = root.querySelector<HTMLElement>("[data-grid]");
  const countEl = root.querySelector<HTMLElement>("[data-count]");
  const formula = root.querySelector<HTMLElement>("[data-formula]");
  const pin = root.querySelector<HTMLElement>("[data-pin]");
  const field = root.querySelector<HTMLCanvasElement>("[data-field]");
  const fieldNote = root.querySelector<HTMLElement>("[data-field-note]");
  const fields = ["from", "to", "when", "stay"].map((k) => root.querySelector<HTMLElement>(`[data-field-${k}]`));
  if (!gridEl || !countEl) return undefined;
  const grid: HTMLElement = gridEl;
  const count: HTMLElement = countEl;
  let spans: HTMLElement[] = [];
  let cells: GridCell[] = [];
  let order: number[] = [];
  let best = 0;
  let scene = SCENES[0];
  let start = 0;
  let index = 0;

  function build(i: number) {
    index = i;
    scene = SCENES[i];
    cells = gridCells(scene, i + 1);
    const winner = cheapestCell(cells);
    best = cells.indexOf(winner);
    const months = gridMonths(scene);
    const nights = scene.maxNights - scene.minNights + 1;
    grid.replaceChildren();
    spans = new Array(cells.length);
    for (const m of months) {
      const block = document.createElement("div");
      block.className = "h-month";
      const title = document.createElement("span");
      title.className = "h-month-name";
      title.textContent = m.label;
      const body = document.createElement("div");
      body.className = "h-cells";
      body.style.setProperty("--cols", String(m.days));
      body.style.setProperty("--rows", String(nights));
      for (let n = 0; n < nights; n++) {
        for (let d = 0; d < m.days; d++) {
          const idx = n * (cells.length / nights) + m.offset + d;
          const s = document.createElement("i");
          s.className = `c${shade(cells[idx].level)}`;
          spans[idx] = s;
          body.append(s);
        }
      }
      block.append(title, body);
      grid.append(block);
    }
    // Reveal day by day (all trip lengths for a day together), with a little jitter.
    order = cells.map((_, k) => k).sort((a, b) => cells[a].day + ((a * 7919) % 5) / 2 - (cells[b].day + ((b * 7919) % 5) / 2));
    const [fromName, toName] = scene.route.split(" → ");
    const [when, stay] = scene.when.split(" · ");
    [fromName, toName, when, stay].forEach((v, k) => { const f = fields[k]; if (f) f.dataset.text = v; });
    if (formula) formula.textContent = `${fmt(scene.airports)} airport ${scene.airports === 1 ? "pair" : "pairs"} × every day × ${nights} trip lengths`;
    if (pin) pin.textContent = `Cheapest: ${cellLabel(scene, winner)}`;
  }

  function drawField(shown: number, done: boolean) {
    if (!field) return;
    const ctx = field.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = field.clientWidth;
    const h = field.clientHeight;
    if (field.width !== w * dpr) { field.width = w * dpr; field.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const total = Math.min(scene.trips, 1200);
    const per = Math.ceil(scene.trips / total);
    const cols = Math.max(1, Math.round(Math.sqrt((total * w) / h)));
    const gap = w / cols;
    const n = Math.min(total, Math.ceil(shown / per));
    const r = Math.max(1, gap * 0.32);
    for (let k = 0; k < n; k++) {
      const x = (k % cols) * gap + gap / 2;
      const y = Math.floor(k / cols) * gap + gap / 2;
      ctx.fillStyle = done && k === Math.floor(total * 0.61) ? "#16a34a" : "rgba(21,112,232,0.55)";
      ctx.beginPath(); ctx.arc(x, y, done && k === Math.floor(total * 0.61) ? r * 2.2 : r, 0, Math.PI * 2); ctx.fill();
    }
    if (fieldNote) fieldNote.textContent = per > 1 ? `1 dot ≈ ${fmt(per)} trips` : "1 dot = 1 trip";
  }

  /** One frame of the sweep, `t` ms into the scene. */
  function frame(t: number) {
    const typing = Math.min(1, t / 900);
    fields.forEach((f) => {
      if (!f) return;
      const text = f.dataset.text ?? "";
      f.textContent = text.slice(0, Math.ceil(text.length * typing));
    });
    const p = Math.min(1, Math.max(0, (t - 900) / 3200));
    const shown = Math.floor(order.length * p);
    for (let k = 0; k < order.length; k++) spans[order[k]].classList.toggle("on", k < shown);
    const done = p >= 1;
    grid.classList.toggle("done", done);
    spans[best].classList.toggle("best", done);
    pin?.classList.toggle("show", done);
    count.textContent = fmt(Math.round(scene.trips * p)) + (done && scene.capped ? "+" : "");
    drawField(Math.round(scene.trips * p), done);
  }

  function setScene(i: number, now: number) { build(i); start = now; frame(reduced ? 1e9 : 0); }
  build(0);
  return { setScene, tick: (now: number) => frame(reduced ? 1e9 : now - start), get index() { return index; } };
}

// ---------------------------------------------------------------- wiring

const globeEl = document.querySelector<HTMLCanvasElement>("[data-globe]");
const sweepEl = document.querySelector<HTMLElement>("[data-sweep]");
const routeEl = document.querySelector<HTMLElement>("[data-route]");
const whenEl = document.querySelector<HTMLElement>("[data-when]");
const dots = [...document.querySelectorAll<HTMLButtonElement>("[data-scene]")];
const globe = globeEl ? createGlobe(globeEl) : undefined;
const sweep = sweepEl ? createSweep(sweepEl) : undefined;

let current = 0;
let sceneAt = performance.now();
let visibleGlobe = true;
let visibleSweep = false;

function show(i: number, now = performance.now()) {
  current = (i + SCENES.length) % SCENES.length;
  sceneAt = now;
  globe?.setScene(SCENES[current], now);
  sweep?.setScene(current, now);
  if (routeEl) routeEl.textContent = SCENES[current].route;
  if (whenEl) whenEl.textContent = SCENES[current].when;
  dots.forEach((d, k) => d.setAttribute("aria-pressed", String(k === current)));
}
dots.forEach((d, k) => d.addEventListener("click", () => show(k)));

const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (e.target === globeEl) visibleGlobe = e.isIntersecting;
    if (e.target === sweepEl) {
      // Restart the sweep when it scrolls into view, so visitors see it fill in.
      if (e.isIntersecting && !visibleSweep && !reduced) sweep?.setScene(current, performance.now());
      visibleSweep = e.isIntersecting;
    }
  }
});
if (globeEl) io.observe(globeEl);
if (sweepEl) io.observe(sweepEl);

if (SCENES.length) {
  show(0);
  document.documentElement.classList.add("home-js");
  if (reduced) {
    // Still pictures: draw once per scene (the dots switch scenes) and on resize.
    const still = () => { const now = performance.now(); globe?.draw(now); sweep?.tick(now); };
    dots.forEach((d) => d.addEventListener("click", () => requestAnimationFrame(still)));
    window.addEventListener("resize", () => requestAnimationFrame(still));
    requestAnimationFrame(still);
  } else {
    const loop = (now: number) => {
      if (now - sceneAt > SCENE_MS && (visibleGlobe || visibleSweep)) show(current + 1, now);
      if (visibleGlobe) globe?.draw(now);
      if (visibleSweep) sweep?.tick(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
