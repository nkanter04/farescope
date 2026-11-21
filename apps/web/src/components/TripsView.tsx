import { useEffect, useState } from "react";
import { lodgingCoverage, tripDates, tripStops, tripTotal } from "@farescope/shared";
import { money, shortDate, travelerCount, tripPriceNote } from "../format.ts";
import { useStore } from "../store.ts";
import { TripComparison } from "./TripComparison.tsx";
import { ShareButton } from "./ShareButton.tsx";
import { WatchedFlights } from "./WatchedFlights.tsx";

export function TripsView() {
  const trips = useStore(s => s.trips);
  const load = useStore(s => s.loadTrips);
  const remove = useStore(s => s.removeTrip);
  const compare = useStore(s => s.compare);
  const toggle = useStore(s => s.toggleCompare);
  const open = useStore(s => s.openTrip);
  const setRequest = useStore(s => s.setRequest);
  const setView = useStore(s => s.setView);
  const runSearch = useStore(s => s.runSearch);
  const [error, setError] = useState("");
  useEffect(() => { void load(); }, [load]);
  const compared = trips.filter(trip => compare.includes(trip.id));
  return <div className="trips-view"><h2>My trips</h2>
    <p className="muted">Saved for this browser. Choose up to three trips to compare.</p>
    {error && <p role="alert" className="notice error">{error}</p>}
    {!trips.length && <p className="empty">Save an option from your search results, then plan its stays here.</p>}
    <ul className="trip-cards">{trips.map(trip => {
      const stops = tripStops(trip);
      const coverage = lodgingCoverage(trip.fare, stops, trip.legs);
      const dates = tripDates(trip);
      return <li key={trip.id} className={`card ${compare.includes(trip.id) ? "sel" : ""}`}>
        <label className="cmp"><input type="checkbox" checked={compare.includes(trip.id)} disabled={compare.length >= 3 && !compare.includes(trip.id)} onChange={() => toggle(trip.id)} /> Compare</label>
        <h3>{trip.name}</h3><div className="big">{money(tripTotal(trip))}</div>
        {tripPriceNote(trip) && <p className="stale small">{tripPriceNote(trip)}</p>}
        <p className="muted small">{coverage.complete ? `${trip.legs ? "Flights" : "Flight"} + planned accommodation` : trip.legs ? "Flights so far" : "Known costs so far"} · {travelerCount(trip.adults)}</p>
        <p className="muted small">{trip.legs ? [trip.legs[0].from, ...trip.legs.map(leg => leg.to)].join(" → ") : `${trip.fare.origin} → ${trip.fare.destination}`} · {shortDate(dates.start)}{dates.end && ` – ${shortDate(dates.end)}`}</p>
        <p className="muted small">{stops.map(stop => stop.place).join(" → ") || "No stays planned"}</p>
        {trip.notes && <p className="trip-notes small">{trip.notes}</p>}
        <div className="trip-actions"><button className="secondary" onClick={() => open(trip)}>Edit itinerary</button>
          {trip.search && <button className="link" onClick={() => { setRequest(trip.search!); setView("search"); void runSearch(); }}>Search these settings</button>}
        </div>
        <ShareButton trips={[trip]} />
        <button className="link danger" onClick={async () => { try { await remove(trip.id); } catch { setError("Could not delete this trip. Try again."); } }}>Delete</button>
      </li>;
    })}</ul>
    {compared.length >= 2 && <><TripComparison trips={compared} /><ShareButton key={compared.map(trip => trip.id).join()} trips={compared} /></>}
    <WatchedFlights />
  </div>;
}
