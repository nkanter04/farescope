import { useState } from "react";
import { daysBetween } from "@farescope/shared";
import { cityOf, duration, money, priceScope, relativeAge, shortDate, stopsLabel, travelerCount } from "../format.ts";
import { useStore } from "../store.ts";

/** Selected flight -> lodging at the destination for those nights -> trip total -> save. */
export function FarePanel() {
  const fare = useStore((s) => s.selectedFare);
  const adults = useStore((s) => s.submitted?.adults);
  const stays = useStore((s) => s.stays);
  const staysStatus = useStore((s) => s.staysStatus);
  const staysError = useStore((s) => s.staysError);
  const stayKind = useStore((s) => s.stayKind);
  const setStayKind = useStore((s) => s.setStayKind);
  const selectedStay = useStore((s) => s.selectedStay);
  const selectStay = useStore((s) => s.selectStay);
  const selectFare = useStore((s) => s.selectFare);
  const save = useStore((s) => s.saveCurrentTrip);
  const [saved, setSaved] = useState<string | null>(null);

  if (!fare) return null;
  const shown = stays.filter((s) => stayKind === "all" || s.kind === stayKind);
  const total = fare.price + (selectedStay?.total ?? 0);
  const defaultName = `${cityOf(fare.destination)} · ${shortDate(fare.departDate)}`;

  return (
    <section className="fare-panel" aria-label="Selected trip">
      <div className="panel-head">
        <button className="link" onClick={() => void selectFare(null)}>
          ← Back to results
        </button>
      </div>

      <div className="card">
        <div className="fare-main">
          <span className="route">
            {cityOf(fare.origin)} → {cityOf(fare.destination)}
          </span>
          <span className="price">{money(fare.price)}</span>
        </div>
        <div className="fare-sub muted">
          {shortDate(fare.departDate)}
          {fare.returnDate && ` – ${shortDate(fare.returnDate)}`} · {stopsLabel(fare.stops)} · {duration(fare.durationMin)}
        </div>
        <ol className="legs">
          {fare.outbound.map((l, i) => (
            <li key={i}>
              <b>
                {l.from} → {l.to}
              </b>{" "}
              {l.airline} {l.flightNumber}
              <span className="muted">
                {" "}
                {l.depart.slice(11)} – {l.arrive.slice(11)}
                {l.arrive.slice(0, 10) !== l.depart.slice(0, 10) ? " (+1)" : ""}
              </span>
            </li>
          ))}
        </ol>
        {fare.returnDate && <p className="muted small">Price is the round-trip total. Return flight options are shown on the booking site.</p>}
        {fare.bookingUrl && (
          <a className="button secondary" href={fare.bookingUrl} target="_blank" rel="noreferrer noopener">
            Search these dates on Google Flights ↗
          </a>
        )}
      </div>

      <h3>Where to stay in {cityOf(fare.destination)}</h3>
      <div className="seg small" role="radiogroup" aria-label="Lodging type">
        {(["all", "hotel", "hostel", "rental"] as const).map((k) => (
          <button key={k} role="radio" aria-checked={stayKind === k} className={stayKind === k ? "on" : ""} onClick={() => setStayKind(k)}>
            {k === "all" ? "All" : k === "rental" ? "Rentals" : `${k[0].toUpperCase()}${k.slice(1)}s`}
          </button>
        ))}
      </div>
      {staysStatus === "loading" && <div className="empty">Finding stays…</div>}
      {staysStatus === "error" && <div className="notice warn">{staysError}</div>}
      {staysStatus === "done" && shown.length === 0 && <div className="empty">No stays of this type found.</div>}
      <ul className="stay-list">
        {shown.map((s) => (
          <li key={s.id}>
            <button className={`stay ${selectedStay?.id === s.id ? "sel" : ""}`} onClick={() => selectStay(selectedStay?.id === s.id ? null : s)}>
              <div className="fare-main">
                <span className="stay-name">{s.name}</span>
                <span className="price">{s.totalBasis === "nightly-estimate" && "Est. "}{money(s.total)}</span>
              </div>
              <div className="fare-sub muted">
                <span>
                  <span className={`kind kind-${s.kind}`}>{s.kind}</span>
                  {s.stars ? ` ${"★".repeat(s.stars)}` : ""}
                  {s.rating ? ` · ${s.rating.toFixed(1)} (${s.reviews?.toLocaleString() ?? 0})` : ""}
                </span>
                <span>{money(s.nightly)}/night</span>
              </div>
            </button>
          </li>
        ))}
      </ul>

      <div className="trip-total">
        <div>
          <div className="muted small">{priceScope(selectedStay)} · {travelerCount(adults)}</div>
          <div className="big">{money(total)}</div>
          <div className="muted small">
            Flight {money(fare.price)}
            {selectedStay ? ` + stay ${money(selectedStay.total)} · ${daysBetween(selectedStay.checkIn, selectedStay.checkOut)} hotel nights` : " · lodging excluded"}
          </div>
          <div className="muted small">{fare.provider === "mock" ? "Simulated airfare" : "Airfare checked"} · {relativeAge(fare.fetchedAt)}</div>
        </div>
        <button
          className="primary"
          onClick={async () => {
            await save(defaultName);
            setSaved(defaultName);
          }}
        >
          Save trip
        </button>
      </div>
      {saved && <div className="notice info">Saved “{saved}”. See it under My trips.</div>}
    </section>
  );
}
