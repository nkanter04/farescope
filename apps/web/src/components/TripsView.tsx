import { useEffect } from "react";
import { cityOf, duration, money, shortDate, stopsLabel } from "../format.ts";
import { useStore } from "../store.ts";

/** Saved trips, with side-by-side comparison of up to three. */
export function TripsView() {
  const trips = useStore((s) => s.trips);
  const load = useStore((s) => s.loadTrips);
  const remove = useStore((s) => s.removeTrip);
  const compare = useStore((s) => s.compare);
  const toggle = useStore((s) => s.toggleCompare);

  useEffect(() => {
    void load();
  }, [load]);

  const compared = trips.filter((t) => compare.includes(t.id));
  const cheapest = Math.min(...compared.map((t) => t.total));

  return (
    <div className="trips-view">
      <h2>My trips</h2>
      <p className="muted">
        Saved on this browser. Tick up to three to compare. Accounts that sync across devices are coming soon.
      </p>
      {trips.length === 0 && <div className="empty">No saved trips yet. Pick a flight, add a stay, and press Save trip.</div>}
      <ul className="trip-cards">
        {trips.map((t) => (
          <li key={t.id} className={`card ${compare.includes(t.id) ? "sel" : ""}`}>
            <label className="cmp">
              <input type="checkbox" checked={compare.includes(t.id)} onChange={() => toggle(t.id)} /> Compare
            </label>
            <h3>{t.name}</h3>
            <div className="big">{money(t.total)}</div>
            <div className="muted small">
              {t.fare.origin} → {t.fare.destination} · {shortDate(t.fare.departDate)}
              {t.fare.returnDate && ` – ${shortDate(t.fare.returnDate)}`}
            </div>
            <div className="muted small">{t.stay ? t.stay.name : "No stay selected"}</div>
            <button className="link danger" onClick={() => void remove(t.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>

      {compared.length >= 2 && (
        <div className="compare">
          <h2>Compare</h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th />
                  {compared.map((t) => (
                    <th key={t.id}>{t.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <Row label="Total" cells={compared.map((t) => <b className={t.total === cheapest ? "best" : ""}>{money(t.total)}</b>)} />
                <Row label="Flight" cells={compared.map((t) => money(t.fare.price))} />
                <Row label="Stay" cells={compared.map((t) => (t.stay ? money(t.stay.total) : "–"))} />
                <Row label="Route" cells={compared.map((t) => `${t.fare.origin} → ${cityOf(t.fare.destination)}`)} />
                <Row
                  label="Dates"
                  cells={compared.map((t) => `${shortDate(t.fare.departDate)}${t.fare.returnDate ? ` – ${shortDate(t.fare.returnDate)}` : ""}`)}
                />
                <Row label="Stops" cells={compared.map((t) => stopsLabel(t.fare.stops))} />
                <Row label="Flight time" cells={compared.map((t) => duration(t.fare.durationMin))} />
                <Row label="Airline" cells={compared.map((t) => t.fare.airlines.join(", "))} />
                <Row label="Lodging" cells={compared.map((t) => (t.stay ? `${t.stay.name} (${t.stay.kind})` : "–"))} />
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, cells }: { label: string; cells: React.ReactNode[] }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {cells.map((c, i) => (
        <td key={i}>{c}</td>
      ))}
    </tr>
  );
}
