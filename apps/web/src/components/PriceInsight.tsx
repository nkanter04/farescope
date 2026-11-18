import { useEffect, useState } from "react";
import type { Cabin, Fare, PriceTrend } from "@farescope/shared";
import { money, shortDate } from "../format.ts";
import { useInsights, watchKey } from "../insights.ts";
import { useStore } from "../store.ts";
import { PriceTrendChart } from "./PriceTrendChart.tsx";

const HEADLINE: Record<PriceTrend["verdict"], { title: string; chart: string; icon: string }> = {
  book: { title: "It’s a good time to book.", chart: "Prices may go up", icon: "✓" },
  wait: { title: "Prices may drop.", chart: "Prices may drop", icon: "↓" },
  steady: { title: "Prices should hold steady.", chart: "Prices are holding steady", icon: "≈" },
};

function detail(t: PriceTrend): string {
  if (t.verdict === "book") {
    return t.lowest.price >= t.currentPrice
      ? `${money(t.currentPrice)} is the lowest price we predict between now and takeoff.`
      : `Today’s ${money(t.currentPrice)} is close to the lowest price we predict before takeoff (${money(t.lowest.price)}).`;
  }
  if (t.verdict === "wait") {
    return `We predict about ${money(t.lowest.price)} around ${shortDate(t.lowest.date)}, ${money(t.currentPrice - t.lowest.price)} less than today.`;
  }
  return `The lowest we predict before takeoff is ${money(t.lowest.price)}, close to today’s ${money(t.currentPrice)}.`;
}

const LEVEL: Record<PriceTrend["level"], string> = { low: "Low price", typical: "Typical price", high: "High price" };

/** Booking advice, price history chart and price watch for the selected flight. */
export function PriceInsight({ fare, cabin, adults }: { fare: Fare; cabin: Cabin; adults: number }) {
  const fares = useStore((s) => s.fares);
  const trend = useInsights((s) => s.trends[fare.id]);
  const loadTrend = useInsights((s) => s.loadTrend);
  const watch = useInsights((s) => s.watches.find((w) => watchKey(w.fare) === watchKey(fare)));
  const toggleWatch = useInsights((s) => s.toggleWatch);
  const watchError = useInsights((s) => s.watchError);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const hasFares = fares.length > 0;
  useEffect(() => {
    // Other flights from this search teach the forecast how prices move before departure.
    const peers = [...fares]
      .filter((f) => f.id !== fare.id)
      .sort((a, b) => Number(b.destination === fare.destination) - Number(a.destination === fare.destination))
      .slice(0, 40);
    void loadTrend(fare, peers);
    // Recompute only when the selected flight changes or results first arrive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fare, hasFares, loadTrend]);

  const watchSwitch = (
    <div className="watch-row">
      <div>
        <span id={`watch-${fare.id}`}>Get notified when prices change</span>
        {watch && (
          <div className="muted small">
            Watching since {money(watch.priceAtWatch)}
            {watch.lastPrice !== watch.priceAtWatch && (
              <span className={watch.lastPrice < watch.priceAtWatch ? "delta down" : "delta up"}>
                {" "}
                · now {money(watch.lastPrice)} ({watch.lastPrice < watch.priceAtWatch ? "−" : "+"}
                {money(Math.abs(watch.lastPrice - watch.priceAtWatch))})
              </span>
            )}
          </div>
        )}
        {watchError && <div className="small bad-text">{watchError}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={!!watch}
        aria-labelledby={`watch-${fare.id}`}
        className={`switch ${watch ? "on" : ""}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await toggleWatch(fare, cabin, adults);
          setBusy(false);
        }}
      >
        <span className="knob" aria-hidden>{watch ? "✓" : "✕"}</span>
      </button>
    </div>
  );

  if (!trend || trend === "loading") {
    return (
      <section className="card price-insight" aria-busy="true">
        <div className="insight-head"><span className="insight-icon pending" aria-hidden /><p className="muted">Checking price trends…</p></div>
        {watchSwitch}
      </section>
    );
  }
  if (trend === "error") {
    return (
      <section className="card price-insight">
        <p className="muted">Price prediction isn’t available for this flight right now.</p>
        {watchSwitch}
      </section>
    );
  }

  const h = HEADLINE[trend.verdict];
  const pastPoints = trend.basis.historyPoints - 1;
  return (
    <section className="card price-insight" aria-label="Price prediction">
      <div className="insight-head">
        <span className={`insight-icon ${trend.verdict}`} aria-hidden>{h.icon}</span>
        <div>
          <p className="insight-title"><strong>{h.title}</strong> {detail(trend)}</p>
          <p className="muted small">
            <span className={`level-chip ${trend.level}`}>{LEVEL[trend.level]}</span> Usually {money(trend.typicalRange[0])}–{money(trend.typicalRange[1])} for these dates
          </p>
          <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide price prediction" : "See price prediction"}
          </button>
        </div>
      </div>
      {open && (
        <div className="insight-chart">
          <h3>{h.chart}</h3>
          <p className="muted small">{detail(trend)} The dotted line is our prediction; the shaded area is the likely range.</p>
          <PriceTrendChart trend={trend} />
          <p className="muted small basis">
            Estimate from {pastPoints > 0 ? `${pastPoints} past prices for these dates` : "today’s price"}
            {trend.basis.curveSeries > 0 ? ` and how ${trend.basis.curveSeries} other flights’ prices moved before departure` : " and typical airline pricing patterns"}
            {trend.basis.simulated ? ". Demo: prices and history are simulated." : "."} Predictions aren’t guaranteed.
          </p>
        </div>
      )}
      {watchSwitch}
    </section>
  );
}
