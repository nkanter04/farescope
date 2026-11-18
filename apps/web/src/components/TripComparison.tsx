import type { ReactNode } from "react";
import { comparableTrips, lodgingCoverage, tripStops, tripTotal, type TripPlan } from "@farescope/shared";
import { duration, money, shortDate, stopsLabel, travelerCount, tripPriceNote } from "../format.ts";

export function TripComparison({ trips }: { trips: TripPlan[] }) {
  const comparable = comparableTrips(trips);
  const cheapest = Math.min(...trips.map(tripTotal));
  const fastest = Math.min(...trips.map(trip => trip.fare.durationMin));
  return <section className="compare">
    <h2>Compare trips</h2>
    {!comparable && <p className="muted small">A lowest-total label requires fully planned nights, matching traveler counts and price sources, and no stale or estimated prices.</p>}
    <p className="muted small">Totals include airfare and entered accommodation costs. Ground transport, meals and other spending are extra. Flight times cover the outbound journey.</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Trip comparison"><table>
      <thead><tr><th scope="col">Trip details</th>{trips.map(trip => <th scope="col" key={trip.id}>{trip.name}</th>)}</tr></thead>
      <tbody>
        <Row label="Known costs" cells={trips.map(trip => <><b className={comparable && tripTotal(trip) === cheapest ? "best" : ""}>{money(tripTotal(trip))}</b>
          <div className="small">{lodgingCoverage(trip.fare, tripStops(trip)).complete ? "All nights planned" : "Partial plan"}</div></>)} />
        <Row label="Price difference" cells={trips.map(trip => comparable ? tripTotal(trip) === cheapest ? "Lowest total" : `${money(tripTotal(trip) - cheapest)} more` : "Not comparable yet")} />
        <Row label="Travelers" cells={trips.map(trip => travelerCount(trip.adults))} />
        <Row label="Prices" cells={trips.map(trip => tripPriceNote(trip) || (trip.fare.provider === "mock" ? "Simulated demo prices" : "Saved quotes and entered costs"))} />
        <Row label="Airfare" cells={trips.map(trip => money(trip.fare.price))} />
        <Row label="Accommodation" cells={trips.map(trip => money(tripTotal(trip) - trip.fare.price))} />
        <Row label="Route" cells={trips.map(trip => `${trip.fare.origin} → ${trip.fare.destination}`)} />
        <Row label="Dates" cells={trips.map(trip => `${shortDate(trip.fare.departDate)}${trip.fare.returnDate ? ` – ${shortDate(trip.fare.returnDate)}` : " · one way"}`)} />
        <Row label="Outbound flight" cells={trips.map(trip => <>{duration(trip.fare.durationMin)} · {stopsLabel(trip.fare.stops)}<div className="small">{trip.fare.durationMin === fastest ? "Shortest flight" : `${duration(trip.fare.durationMin - fastest)} longer`}</div></>)} />
        <Row label="Stay locations" cells={trips.map(trip => tripStops(trip).map(stop => stop.place).join(" → ") || "No stays planned")} />
        <Row label="Planned nights" cells={trips.map(trip => lodgingCoverage(trip.fare, tripStops(trip)).nights)} />
        <Row label="Notes" cells={trips.map(trip => trip.notes || "—")} />
      </tbody>
    </table></div>
  </section>;
}

function Row({ label, cells }: { label: string; cells: ReactNode[] }) {
  return <tr><th scope="row">{label}</th>{cells.map((cell, i) => <td key={i}>{cell}</td>)}</tr>;
}
