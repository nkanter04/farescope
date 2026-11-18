import { useEffect, useId, useMemo, useRef, useState } from "react";
import { daysBetween, type PriceTrend } from "@farescope/shared";
import { money, shortDate } from "../format.ts";

const H = 240;
const PAD = { left: 8, right: 70, top: 16, bottom: 30 };

/**
 * Past prices (solid), today's price (dot), and the predicted path to departure (dotted line with
 * a shaded 80% range). Drawn as plain SVG so it scales to any width and needs no chart library.
 */
export function PriceTrendChart({ trend }: { trend: PriceTrend }) {
  const titleId = useId();
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the real pixel width so labels stay 12px on phones instead of shrinking with the SVG.
  const figure = useRef<HTMLElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = figure.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const g = useMemo(() => {
    const start = trend.history[0]?.date ?? trend.today;
    const end = trend.departDate > trend.today ? trend.departDate : trend.today;
    const span = Math.max(1, daysBetween(start, end));
    const values = [
      ...trend.history.map((p) => p.price),
      ...trend.forecast.flatMap((f) => [f.low, f.high]),
      trend.average,
    ];
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const pad = Math.max(10, (rawMax - rawMin) * 0.08);
    const step = rawMax - rawMin > 600 ? 100 : 50;
    const min = Math.max(0, Math.floor((rawMin - pad) / step) * step);
    const max = Math.ceil((rawMax + pad) / step) * step;
    const x = (date: string) => PAD.left + (daysBetween(start, date) / span) * (W - PAD.left - PAD.right);
    const y = (price: number) => PAD.top + (1 - (price - min) / (max - min)) * (H - PAD.top - PAD.bottom);
    const line = (pts: { date: string; price: number }[]) =>
      pts.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.price).toFixed(1)}`).join(" ");
    const now = { date: trend.today, price: trend.currentPrice };
    const band = trend.forecast.length
      ? `M${x(now.date)},${y(now.price)} ` +
        trend.forecast.map((f) => `L${x(f.date).toFixed(1)},${y(f.high).toFixed(1)}`).join(" ") +
        " " +
        [...trend.forecast].reverse().map((f) => `L${x(f.date).toFixed(1)},${y(f.low).toFixed(1)}`).join(" ") +
        " Z"
      : "";
    const points = [...trend.history, ...trend.forecast.map((f) => ({ date: f.date, price: f.price }))];
    return {
      start, min, max, x, y, band, points,
      history: line(trend.history),
      forecast: trend.forecast.length ? line([now, ...trend.forecast]) : "",
      daysAgo: daysBetween(start, trend.today),
    };
  }, [trend, W]);

  const hovered = hover === null ? null : g.points[hover];
  const isForecast = hovered ? hovered.date > trend.today : false;
  const forecastAt = hovered && isForecast ? trend.forecast.find((f) => f.date === hovered.date) : undefined;

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    for (let i = 1; i < g.points.length; i++) {
      if (Math.abs(g.x(g.points[i].date) - px) < Math.abs(g.x(g.points[best].date) - px)) best = i;
    }
    setHover(best);
  };

  const yTicks = [g.max, g.min];
  const lowestShown = trend.verdict === "wait" && trend.lowest.date !== trend.today;

  return (
    <figure className="trend-chart" ref={figure}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby={titleId}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <title id={titleId}>
          {`Price history over the last ${g.daysAgo} days and predicted prices until departure on ${shortDate(trend.departDate)}. ` +
            `Today ${money(trend.currentPrice)}, average ${money(trend.average)}, lowest predicted ${money(trend.lowest.price)} on ${shortDate(trend.lowest.date)}.`}
        </title>
        {yTicks.map((v) => (
          <g key={v}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={g.y(v)} y2={g.y(v)} />
            <text className="axis" x={W - PAD.right + 8} y={g.y(v) + 4}>{money(v)}</text>
          </g>
        ))}
        <line className="avg" x1={PAD.left} x2={W - PAD.right} y1={g.y(trend.average)} y2={g.y(trend.average)} />
        <text className="axis avg-label" x={W - PAD.right + 8} y={g.y(trend.average) - 4}>Avg</text>
        <text className="axis avg-label" x={W - PAD.right + 8} y={g.y(trend.average) + 11}>{money(trend.average)}</text>

        {g.band && <path className="band" d={g.band} />}
        <path className="history" d={g.history} />
        {g.forecast && <path className="forecast" d={g.forecast} />}

        <line className="today" x1={g.x(trend.today)} x2={g.x(trend.today)} y1={PAD.top - 6} y2={H - PAD.bottom} />
        {lowestShown && (
          <circle className="lowest" cx={g.x(trend.lowest.date)} cy={g.y(trend.lowest.price)} r={5} />
        )}
        <circle className="now" cx={g.x(trend.today)} cy={g.y(trend.currentPrice)} r={6} />

        {hovered && (
          <g className="hover" pointerEvents="none">
            <line x1={g.x(hovered.date)} x2={g.x(hovered.date)} y1={PAD.top} y2={H - PAD.bottom} />
            <circle cx={g.x(hovered.date)} cy={g.y(hovered.price)} r={4} />
          </g>
        )}

        <text className="axis" x={PAD.left} y={H - 8}>{g.daysAgo} days ago</text>
        {g.x(trend.today) - PAD.left > 80 && W - PAD.right - g.x(trend.today) > 80 && (
          <text className="axis" x={g.x(trend.today)} y={H - 8} textAnchor="middle">Today</text>
        )}
        <text className="axis" x={W - PAD.right} y={H - 8} textAnchor="end">Departure</text>
      </svg>
      <figcaption className="trend-readout" aria-live="polite">
        {hovered ? (
          <>
            <strong>{money(hovered.price)}</strong> {isForecast ? "predicted" : "seen"} {shortDate(hovered.date)}
            {forecastAt && <span className="muted"> · likely {money(forecastAt.low)}–{money(forecastAt.high)}</span>}
          </>
        ) : (
          <span className="muted">
            <span className="key key-history" /> Past prices <span className="key key-forecast" /> Prediction
            <span className="key key-band" /> Likely range
          </span>
        )}
      </figcaption>
    </figure>
  );
}
