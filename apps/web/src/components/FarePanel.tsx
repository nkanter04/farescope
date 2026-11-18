import { useState } from "react";
import { addDays, AIRPORT_BY_IATA, carrierFrom, codeFromFlightNumber, COUNTRIES, lodgingCoverage, tripTotal } from "@farescope/shared";
import { AirlineLogo, FareAirlines } from "./AirlineLogo.tsx";
import { cityOf, duration, money, shortDate, stopsLabel, travelerCount, tripPriceNote } from "../format.ts";
import { useStore } from "../store.ts";
import { LodgingEditor } from "./LodgingEditor.tsx";
import { PriceInsight } from "./PriceInsight.tsx";
import { TripTimeline } from "./TripTimeline.tsx";

export function FarePanel() {
  const draft = useStore(state => state.draft);
  const setDraft = useStore(state => state.setDraft);
  const selectFare = useStore(state => state.selectFare);
  const save = useStore(state => state.saveCurrentTrip);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  if (!draft) return null;
  const { fare } = draft;
  const stops = draft.lodging ?? [];
  const coverage = lodgingCoverage(fare, stops);
  const valid = draft.name.trim() && stops.every(stop => stop.place.trim() && stop.checkIn && stop.checkOut > stop.checkIn);
  const addStop = () => {
    setStatus("");
    const arrival = fare.outbound.at(-1)?.arrive.slice(0, 10) || fare.departDate;
    const checkIn = [...stops].sort((a, b) => a.checkOut.localeCompare(b.checkOut)).at(-1)?.checkOut ?? arrival;
    const airport = AIRPORT_BY_IATA[fare.destination];
    const place = stops.length ? "" : `${cityOf(fare.destination)}, ${COUNTRIES[airport?.country]?.name ?? ""}`;
    setDraft({ lodging: [...stops, { id: crypto.randomUUID(), place, checkIn,
      checkOut: fare.returnDate && checkIn < fare.returnDate ? addDays(checkIn, 1) : "" }] });
  };
  return <section className="fare-panel">
    <button className="link" onClick={() => void selectFare(null)}>← Back to results</button>
    <div className="card flight-summary">
      <div className="fare-main"><strong>{cityOf(fare.origin)} → {cityOf(fare.destination)}</strong><strong className="price">{money(fare.price)}</strong></div>
      <p className="fare-carrier-line"><FareAirlines fare={fare} size={28} /></p>
      <p>{shortDate(fare.departDate)}{fare.returnDate && ` – ${shortDate(fare.returnDate)}`} · {stopsLabel(fare.stops)} outbound · {duration(fare.durationMin)}</p>
      <details><summary>Flight segments</summary><ol className="segments">{fare.outbound.map((leg, i) => <li key={i}>
        <AirlineLogo carrier={carrierFrom(leg.airline, leg.airlineCode ?? codeFromFlightNumber(leg.flightNumber), leg.airlineLogo)} size={20} label />
        <span>{leg.from} → {leg.to} · {leg.airline} {leg.flightNumber} · {leg.depart} – {leg.arrive}</span>
      </li>)}</ol></details>
      {fare.returnDate && <p className="muted small">Round-trip airfare. Return flight details are available with the supplier.</p>}
      {fare.bookingUrl?.startsWith("https://") && <a className="secondary" href={fare.bookingUrl} target="_blank" rel="noreferrer">Search these flight dates ↗</a>}
    </div>
    <PriceInsight fare={fare} cabin={draft.search?.cabin ?? "economy"} adults={draft.adults ?? draft.search?.adults ?? 1} />
    <div className="row">
      <label className="field">Trip name<input maxLength={120} value={draft.name} onChange={event => { setDraft({ name: event.target.value }); setStatus(""); }} /></label>
      {!draft.adults && <label className="field">Adults<input type="number" min={1} max={9} placeholder="Unknown" onChange={event => setDraft({ adults: Math.max(1, Math.min(9, Number(event.target.value))) })} /></label>}
    </div>
    <div className="editor-heading"><h2>Where you’ll stay</h2><button className="secondary" disabled={stops.length >= 30} onClick={addStop}>Add a stay</button></div>
    {!stops.length && <p className="muted">Choose any city, neighborhood, or address and the nights you’ll spend there.</p>}
    {stops.map(stop => <LodgingEditor key={stop.id} fare={fare} stop={stop} adults={draft.adults}
      onChange={patch => { setDraft({ lodging: stops.map(item => item.id === stop.id ? { ...item, ...patch } : item) }); setStatus(""); }}
      onRemove={() => { setDraft({ lodging: stops.filter(item => item.id !== stop.id) }); setStatus(""); }} />)}
    {coverage.conflict && <p className="notice warn">Some stays overlap or fall outside your flight dates. Check the dates before booking.</p>}
    {coverage.gaps > 0 && <p className="notice info">{coverage.gaps} {coverage.gaps === 1 ? "night" : "nights"} still to plan. Add accommodation or record a stay you’ve arranged yourself.</p>}
    {coverage.unpriced > 0 && <p className="muted small">{coverage.unpriced} {coverage.unpriced === 1 ? "stay has" : "stays have"} no cost yet.</p>}
    {!!stops.length && <TripTimeline fare={fare} stops={stops} />}
    <label className="field">Trip notes<textarea rows={3} maxLength={5000} value={draft.notes ?? ""} placeholder="Train plans, places to visit, or questions for your travel companion"
      onChange={event => { setDraft({ notes: event.target.value }); setStatus(""); }} /></label>
    <div className="trip-total">
      <div><div className="muted small">{coverage.complete ? "Flight + planned accommodation" : "Known costs so far"} · {travelerCount(draft.adults)}</div>
        <div className="big">{money(tripTotal(draft))}</div>
        {tripPriceNote(draft) && <div className="stale small">{tripPriceNote(draft)}</div>}
        <div className="muted small">Airfare {money(fare.price)} + accommodation {money(tripTotal(draft) - fare.price)}</div>
      </div>
      <button className="primary" disabled={!valid || saving} onClick={async () => {
        setSaving(true);
        setStatus("Saving…");
        try { setStatus(await save() ? "Saved to My trips." : "Saved. Your newer edits still need saving."); }
        catch (error) { setStatus((error as Error).message); }
        finally { setSaving(false); }
      }}>{saving ? "Saving…" : draft.id ? "Save changes" : "Save trip"}</button>
    </div>
    {status && <p role="status" className="notice info">{status}</p>}
  </section>;
}
