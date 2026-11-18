import { AIRPORT_BY_IATA, daysBetween, type Fare, type LodgingStop } from "@farescope/shared";
import { money, shortDate } from "../format.ts";

function directions(from: string, to: string) {
  return "https://www.google.com/maps/dir/?" + new URLSearchParams({ api: "1", origin: from, destination: to });
}

export function TripTimeline({ fare, stops }: { fare: Fare; stops: LodgingStop[] }) {
  const airport = AIRPORT_BY_IATA[fare.destination];
  const arrival = airport ? `${airport.name}, ${airport.city}` : `${fare.destination} airport`;
  const sorted = [...stops].sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const places = sorted.map(stop => stop.stay?.provider === "mock" ? stop.place : [stop.stay?.name, stop.place].filter(Boolean).join(", "));
  return <section className="trip-route" aria-label="Trip route">
    <h3>Your route</h3>
    <ol className="timeline">
      <li><strong>Arrive · {arrival}</strong><span>{shortDate(fare.outbound.at(-1)?.arrive.slice(0, 10) || fare.departDate)}</span></li>
      {sorted.map((stop, i) => <li key={stop.id}>
        <a href={directions(i ? places[i - 1] : arrival, places[i])} target="_blank" rel="noreferrer">Map this transfer ↗</a>
        <strong>{stop.place || "Choose a place"}</strong>
        <span>{stop.checkIn && stop.checkOut ? `${shortDate(stop.checkIn)} – ${shortDate(stop.checkOut)} · ${daysBetween(stop.checkIn, stop.checkOut)} nights` : "Choose dates"}</span>
        <span>{stop.stay?.name ?? (stop.ownCost !== undefined ? `Accommodation arranged · ${money(stop.ownCost)}` : "Accommodation to plan")}</span>
      </li>)}
      {fare.returnDate && <li>
        {!!places.length && <a href={directions(places.at(-1)!, arrival)} target="_blank" rel="noreferrer">Map return to airport ↗</a>}
        <strong>Depart · {arrival}</strong><span>{shortDate(fare.returnDate)}</span>
      </li>}
    </ol>
    <p className="muted small">Maps open in Google Maps. Ground transport costs are additional.</p>
  </section>;
}
