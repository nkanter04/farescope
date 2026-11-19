import { useEffect, useRef, useState } from "react";
import { daysBetween, suggestPlaces, type Fare, type LodgingStop, type Stay, type StayKind } from "@farescope/shared";
import { fetchStays } from "../api.ts";
import { money } from "../format.ts";
import { useStore } from "../store.ts";
import { BookLinks } from "./BookLinks.tsx";

export function LodgingEditor({ fare, stop, adults, onChange, onRemove }: {
  fare: Fare; stop: LodgingStop; adults?: number; onChange(patch: Partial<LodgingStop>): void; onRemove(): void;
}) {
  const [results, setResults] = useState<Stay[]>([]);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [kind, setKind] = useState<StayKind | "all">("all");
  const sequence = useRef(0);
  useEffect(() => {
    sequence.current++;
    setResults([]);
    setStatus("idle");
    setError("");
    return () => { sequence.current++; };
  }, [stop.place, stop.checkIn, stop.checkOut, adults]);
  const valid = stop.place.trim().length >= 2 && stop.checkIn && stop.checkOut && stop.checkOut > stop.checkIn && adults !== undefined;
  const update = (patch: Partial<LodgingStop>) => {
    sequence.current++;
    setResults([]);
    onChange({ ...patch, stay: undefined });
  };
  const search = async () => {
    if (!valid || !adults) return;
    const current = ++sequence.current;
    setStatus("loading");
    setError("");
    try {
      const response = await fetchStays(fare.destination, stop, adults);
      if (current !== sequence.current) return;
      setResults(response.stays);
      setError(response.error ?? "");
      setStatus("done");
    } catch {
      if (current !== sequence.current) return;
      setError("Could not load stays. Try again.");
      setStatus("done");
    } finally { void useStore.getState().refreshQuota(); }
  };
  return <section className="lodging-editor card">
    <div className="editor-heading"><h3>{stop.place || "New stay"}</h3><button className="link danger" onClick={onRemove}>Remove stay</button></div>
    <label className="field">Where to stay
      <input value={stop.place} maxLength={160} list={`places-${stop.id}`} placeholder="City, neighborhood or address"
        onChange={event => update({ place: event.target.value })} />
    </label>
    <datalist id={`places-${stop.id}`}>{suggestPlaces(stop.place).map(place => <option key={place.token} value={place.label} />)}</datalist>
    <div className="row">
      <label className="field">Check-in<input type="date" value={stop.checkIn} onChange={event => update({ checkIn: event.target.value })} /></label>
      <label className="field">Check-out<input type="date" min={stop.checkIn} value={stop.checkOut} onChange={event => update({ checkOut: event.target.value })} /></label>
    </div>
    {stop.checkOut > stop.checkIn && <p className="muted small">{daysBetween(stop.checkIn, stop.checkOut)} nights</p>}
    <label className="cmp"><input type="checkbox" checked={stop.ownCost !== undefined} onChange={event => {
      sequence.current++; setResults([]); setStatus("idle");
      onChange({ stay: undefined, ownCost: event.target.checked ? 0 : undefined });
    }} /> I’ve arranged my own accommodation</label>
    {stop.ownCost !== undefined ? <label className="field">Accommodation cost for this stay (USD)
      <input type="number" min={0} step="0.01" value={stop.ownCost} onChange={event => onChange({ ownCost: Math.max(0, Number(event.target.value)) })} />
    </label> : <>
      {stop.stay && <div className="chosen-stay">
        <strong>{stop.stay.name}</strong><span>{stop.stay.totalBasis === "nightly-estimate" && "Est. "}{money(stop.stay.total)} for this stay</span>
        {stop.stay.stale && <span className="stale">Older price</span>}
        {stop.stay.url?.startsWith("https://") && <a href={stop.stay.url} target="_blank" rel="noreferrer">View accommodation ↗</a>}
        <BookLinks kind={stop.stay.kind === "hostel" ? "hostel" : "stay"} ctx={{ city: stop.place, checkIn: stop.checkIn, checkOut: stop.checkOut, adults }} />
        <button className="link" onClick={() => onChange({ stay: undefined })}>Clear accommodation</button>
      </div>}
      <div className="editor-actions">
        <label className="field">Lodging type<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}>
          <option value="all">All types</option><option value="hotel">Hotels</option><option value="hostel">Hostels</option><option value="rental">Rentals</option>
        </select></label>
        <button className="secondary" disabled={!valid || status === "loading"} onClick={() => void search()}>{status === "loading" ? "Searching…" : "Search stays"}</button>
      </div>
      {!adults && <p className="muted small">Set the traveler count above to search stays.</p>}
      {error && <p role="alert" className="notice error">{error}</p>}
      {stop.place.trim().length >= 2 && stop.checkOut > stop.checkIn && <BookLinks kind={kind === "hostel" ? "hostel" : "stay"} ctx={{ city: stop.place, checkIn: stop.checkIn, checkOut: stop.checkOut, adults }} />}
      {status === "done" && !error && !results.some(stay => kind === "all" || stay.kind === kind) && <p role="status">No stays found for these dates and preferences.</p>}
      <ul className="stay-list">{results.filter(stay => kind === "all" || stay.kind === kind).map(stay => <li key={stay.id}>
        <button className={`stay ${stop.stay?.id === stay.id ? "sel" : ""}`} onClick={() => { onChange({ stay, ownCost: undefined }); setResults([]); setStatus("idle"); }}>
          <span className="fare-main"><strong>{stay.name}</strong><span className="price">{stay.totalBasis === "nightly-estimate" && "Est. "}{money(stay.total)}</span></span>
          <span className="fare-sub">{stay.kind} · {stay.rating ? `${stay.rating}/5` : "Unrated"} · {money(stay.nightly)}/night</span>
        </button>
      </li>)}</ul>
    </>}
  </section>;
}
