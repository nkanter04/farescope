import { useEffect, useMemo, useRef, useState } from "react";
import GlobeGL, { type GlobeMethods } from "react-globe.gl";
import { AIRPORT_BY_IATA, resolveAll, type Fare } from "@farescope/shared";
import { useDerived } from "../derived.ts";
import { cityOf, money, priceColor } from "../format.ts";
import { useStore } from "../store.ts";
import { useGlobeTheme } from "../theme.ts";

const BASE = import.meta.env.BASE_URL;

interface ArcDatum {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: [string, string];
  fare: Fare;
  stroke: number;
}
interface PointDatum {
  lat: number;
  lng: number;
  iata: string;
  kind: "origin" | "dest";
  color: string;
  price?: number;
}

type Vec3 = [number, number, number];
const RAD = Math.PI / 180;

function toVec(lat: number, lng: number): Vec3 {
  return [Math.cos(lat * RAD) * Math.cos(lng * RAD), Math.cos(lat * RAD) * Math.sin(lng * RAD), Math.sin(lat * RAD)];
}
function centroid3(vs: Vec3[]): Vec3 {
  const s = vs.reduce<Vec3>((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0]);
  const n = Math.hypot(...s) || 1;
  return [s[0] / n, s[1] / n, s[2] / n];
}
function centroid(iatas: string[]): Vec3 | undefined {
  const vs = iatas.map((i) => AIRPORT_BY_IATA[i]).filter(Boolean).map((a) => toVec(a.lat, a.lng));
  return vs.length ? centroid3(vs) : undefined;
}
function toLatLng(v: Vec3) {
  return { lat: Math.asin(v[2]) / RAD, lng: Math.atan2(v[1], v[0]) / RAD };
}

/** Interactive globe: arcs from origins to every destination, colored by the cheapest fare. */
export function Globe() {
  const wrap = useRef<HTMLDivElement>(null);
  const globe = useRef<GlobeMethods | undefined>(undefined);
  const [size, setSize] = useState({ w: 600, h: 400 });
  const request = useStore((s) => s.submitted ?? s.request);
  const filterDest = useStore((s) => s.filterDest);
  const setFilterDest = useStore((s) => s.setFilterDest);
  const selected = useStore((s) => s.selectedFare);
  const { destBest, destMin, destMax } = useDerived();
  const theme = useGlobeTheme();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const origins = useMemo(() => resolveAll(request.origins).airports, [request.origins]);
  const destinations = useMemo(() => resolveAll(request.destinations).airports, [request.destinations]);

  // Fly to the midpoint between the origin area and the destination area (weighted equally, so
  // eight Japanese airports don't outvote one Austin), zooming out for longer routes.
  useEffect(() => {
    if (!globe.current) return;
    const o = centroid(origins);
    const d = centroid(destinations);
    if (!o && !d) return;
    const mid = centroid3([o, d].filter((v): v is Vec3 => !!v));
    const angle = o && d ? (Math.acos(Math.min(1, Math.max(-1, o[0] * d[0] + o[1] * d[1] + o[2] * d[2]))) * 180) / Math.PI : 0;
    const spread = destinations.length > 40 ? 3 : 1.5 + Math.min(1.6, angle / 70);
    globe.current.pointOfView({ ...toLatLng(mid), altitude: spread }, 1200);
  }, [origins, destinations]);

  useEffect(() => {
    const g = globe.current;
    if (!g) return;
    const c = g.controls();
    c.autoRotate = destBest.size === 0;
    c.autoRotateSpeed = 0.35;
  }, [destBest.size]);

  const span = Math.max(1, destMax - destMin);
  const arcs: ArcDatum[] = useMemo(() => {
    const out: ArcDatum[] = [];
    for (const f of destBest.values()) {
      if (filterDest && f.destination !== filterDest) continue;
      const a = AIRPORT_BY_IATA[f.origin];
      const b = AIRPORT_BY_IATA[f.destination];
      if (!a || !b) continue;
      const t = (f.price - destMin) / span;
      out.push({
        startLat: a.lat,
        startLng: a.lng,
        endLat: b.lat,
        endLng: b.lng,
        color: [priceColor(t, 0.25), priceColor(t, 0.95)],
        fare: f,
        stroke: (selected?.destination === f.destination ? 1.2 : 0.55) * theme.arcScale,
      });
    }
    return out;
  }, [destBest, filterDest, destMin, span, selected, theme]);

  const points: PointDatum[] = useMemo(() => {
    const out: PointDatum[] = [];
    for (const i of origins) {
      const a = AIRPORT_BY_IATA[i];
      if (a) out.push({ lat: a.lat, lng: a.lng, iata: i, kind: "origin", color: theme.origin });
    }
    for (const i of destinations) {
      const a = AIRPORT_BY_IATA[i];
      const f = destBest.get(i);
      if (a && !origins.includes(i)) {
        out.push({
          lat: a.lat,
          lng: a.lng,
          iata: i,
          kind: "dest",
          color: f ? priceColor((f.price - destMin) / span) : theme.mutedPoint,
          price: f?.price,
        });
      }
    }
    return out;
  }, [origins, destinations, destBest, destMin, span, theme]);

  // Price labels only for the cheapest handful, to avoid clutter.
  const labels = useMemo(
    () =>
      [...destBest.values()]
        .sort((a, b) => a.price - b.price)
        .slice(0, filterDest ? 1 : 8)
        .filter((f) => !filterDest || f.destination === filterDest)
        .map((f) => ({ ...AIRPORT_BY_IATA[f.destination], text: `${f.destination} ${money(f.price)}` })),
    [destBest, filterDest],
  );

  return (
    <div className="globe-wrap" ref={wrap}>
      <GlobeGL
        ref={globe}
        width={size.w}
        height={size.h}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl={`${BASE}earth-${theme.texture}.jpg`}
        bumpImageUrl={`${BASE}earth-topology.png`}
        atmosphereColor={theme.atmosphere}
        atmosphereAltitude={0.18}
        arcsData={arcs}
        arcColor={(d: object) => (d as ArcDatum).color}
        arcStroke={(d: object) => (d as ArcDatum).stroke}
        arcDashLength={0.5}
        arcDashGap={0.15}
        arcDashAnimateTime={2400}
        arcAltitudeAutoScale={0.42}
        arcLabel={(d: object) => {
          const f = (d as ArcDatum).fare;
          return `<div class="globe-tip"><b>${f.origin} → ${f.destination}</b> ${cityOf(f.destination)}<br/>from ${money(f.price)}</div>`;
        }}
        onArcClick={(d: object) => setFilterDest((d as ArcDatum).fare.destination)}
        pointsData={points}
        pointColor={(d: object) => (d as PointDatum).color}
        pointAltitude={(d: object) => ((d as PointDatum).kind === "origin" ? 0.02 : 0.01)}
        pointRadius={(d: object) => ((d as PointDatum).kind === "origin" ? 0.45 : 0.32)}
        pointLabel={(d: object) => {
          const p = d as PointDatum;
          return `<div class="globe-tip"><b>${cityOf(p.iata)} (${p.iata})</b>${p.price ? `<br/>from ${money(p.price)}` : ""}</div>`;
        }}
        onPointClick={(d: object) => {
          const p = d as PointDatum;
          if (p.kind === "dest") setFilterDest(filterDest === p.iata ? null : p.iata);
        }}
        labelsData={labels}
        labelText="text"
        labelSize={0.55}
        labelDotRadius={0}
        labelColor={() => theme.label}
        labelAltitude={0.015}
        labelResolution={2}
      />
      {destBest.size > 0 && (
        <div className="legend" aria-hidden>
          <span>{money(destMin)}</span>
          <span className="ramp" />
          <span>{money(destMax)}</span>
        </div>
      )}
    </div>
  );
}
