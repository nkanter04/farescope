import { cityOf, money, shortDate, stopsLabel } from "../format.ts";
import { useInsights } from "../insights.ts";
import { useStore } from "../store.ts";
import { FareAirlines } from "./AirlineLogo.tsx";

function checkedAgo(iso: string): string {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/** Flights the user is watching, with the price change since they started watching. */
export function WatchedFlights() {
  const watches = useInsights((s) => s.watches);
  const unwatch = useInsights((s) => s.unwatch);
  const selectFare = useStore((s) => s.selectFare);
  const setView = useStore((s) => s.setView);
  if (!watches.length) return null;
  return (
    <section className="watched" aria-label="Watched flights">
      <h2>Watched flights</h2>
      <p className="muted">Prices are re-checked when you open Farescope, at most every 6 hours per flight.</p>
      <ul className="watch-list">
        {watches.map((w) => {
          const diff = w.lastPrice - w.priceAtWatch;
          return (
            <li key={w.id} className="card watch-card">
              <div className="fare-main">
                <strong>{cityOf(w.fare.origin)} → {cityOf(w.fare.destination)}</strong>
                <strong className="price">{money(w.lastPrice)}</strong>
              </div>
              <p className="fare-carrier-line"><FareAirlines fare={w.fare} /></p>
              <p className="muted small">
                {shortDate(w.fare.departDate)}{w.fare.returnDate && ` – ${shortDate(w.fare.returnDate)}`} · {stopsLabel(w.fare.stops)}
              </p>
              {w.status === "departed" ? (
                <p className="small muted">This flight has departed.</p>
              ) : w.status === "unavailable" ? (
                <p className="small delta up">No longer found. It may be sold out.</p>
              ) : diff === 0 ? (
                <p className="small muted">No change since you started watching at {money(w.priceAtWatch)}.</p>
              ) : (
                <p className={`small delta ${diff < 0 ? "down" : "up"}`}>
                  {diff < 0 ? "Dropped" : "Up"} {money(Math.abs(diff))} since you started watching at {money(w.priceAtWatch)}
                </p>
              )}
              <p className="muted small">Checked {checkedAgo(w.lastChecked)}</p>
              <div className="trip-actions">
                {w.status !== "departed" && (
                  <button className="secondary" onClick={() => { void selectFare(w.fare); setView("search"); }}>View flight</button>
                )}
                <button className="link danger" onClick={() => void unwatch(w.id)}>Stop watching</button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
