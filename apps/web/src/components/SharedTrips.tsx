import { useEffect, useState } from "react";
import { lodgingCoverage, tripStops, tripTotal, type TripPlan } from "@farescope/shared";
import { readShareLink } from "../share.ts";
import { money, travelerCount, tripPriceNote } from "../format.ts";
import { TripComparison } from "./TripComparison.tsx";
import { TripTimeline } from "./TripTimeline.tsx";

export function SharedTrips({ hash }: { hash: string }) {
  const [trips, setTrips] = useState<TripPlan[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setTrips([]); setError("");
    void readShareLink(hash).then(data => { if (active) setTrips(data); }).catch(() => { if (active) setError("This shared link is invalid or incomplete. Ask the sender for a new link."); });
    return () => { active = false; };
  }, [hash]);
  return <main className="single shared-trips"><h1>Shared itinerary</h1><p className="muted">Read-only snapshot. Prices may have changed since this plan was saved.</p>
    <a href={window.location.pathname + window.location.search}>Open Tripica</a>
    {error && <p role="alert">{error}</p>}
    {!error && !trips.length && <p role="status">Loading itinerary…</p>}
    {trips.length > 1 && <TripComparison trips={trips} />}
    {trips.map(trip => <article className="card" key={trip.id}><h2>{trip.name}</h2><div className="big">{money(tripTotal(trip))}</div>
      <p>{lodgingCoverage(trip.fare, tripStops(trip)).complete ? "Flight + planned accommodation" : "Known costs so far"} · {travelerCount(trip.adults)}</p>
      {tripPriceNote(trip) && <p className="stale small">{tripPriceNote(trip)}</p>}
      {trip.fare.provider === "mock" && <p className="notice info">Demo itinerary · simulated prices and flight times.</p>}
      <p>{trip.fare.origin} → {trip.fare.destination}</p>
      <TripTimeline fare={trip.fare} stops={tripStops(trip)} />
      {trip.notes && <p className="trip-notes">{trip.notes}</p>}
    </article>)}
  </main>;
}
