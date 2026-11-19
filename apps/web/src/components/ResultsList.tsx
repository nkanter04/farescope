import { useEffect, useState } from "react";
import { CHECK_EVENT } from "../human.ts";
import { daysBetween, type Fare, type Stay } from "@farescope/shared";
import { AirlineFilter } from "./AirlineFilter.tsx";
import { FareAirlines } from "./AirlineLogo.tsx";
import { useDerived } from "../derived.ts";
import { cityOf, fareEnds, duration, money, relativeAge, shortDate, stopsLabel, travelerCount } from "../format.ts";
import { passesAirlines } from "../derived.ts";
import { ANY_AIRLINE, useStore } from "../store.ts";

/** True while the Turnstile robot check runs (see human.ts). */
function useHumanCheck(): boolean {
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setChecking((e as CustomEvent<boolean>).detail);
    window.addEventListener(CHECK_EVENT, on);
    return () => window.removeEventListener(CHECK_EVENT, on);
  }, []);
  return checking;
}

export function ResultsList() {
  const status = useStore((s) => s.status);
  const progress = useStore((s) => s.progress);
  const notices = useStore((s) => s.notices);
  const filterDest = useStore((s) => s.filterDest);
  const filterDate = useStore((s) => s.filterDate);
  const setFilterDest = useStore((s) => s.setFilterDest);
  const setFilterDate = useStore((s) => s.setFilterDate);
  const selectFare = useStore((s) => s.selectFare);
  const selected = useStore((s) => s.selectedFare);
  const shortlist = useStore((s) => s.shortlist);
  const adults = useStore((s) => s.submitted?.adults);
  const submitted = useStore((s) => s.submitted);
  const setRequest = useStore((s) => s.setRequest);
  const runSearch = useStore((s) => s.runSearch);
  const sort = useStore(s => s.sort);
  const fares = useStore((s) => s.fares);
  const setSort = useStore(s => s.setSort);
  const airlines = useStore((s) => s.request.airlines ?? ANY_AIRLINE);
  const quotes = shortlist?.quotes.filter(({ fare }) =>
    (!filterDest || fare.destination === filterDest) && (!filterDate || fare.departDate === filterDate) && passesAirlines(fare, airlines))
    .sort((a, b) => (sort === "duration" ? a.fare.durationMin - b.fare.durationMin : sort === "stops" ? a.fare.stops - b.fare.stops :
      sort === "airfare" ? a.fare.price - b.fare.price : a.fare.price + a.stay.total - b.fare.price - b.stay.total) || a.fare.price - b.fare.price);
  const { list } = useDerived();

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const checking = useHumanCheck();

  return (
    <section className="results">
      {status !== "idle" && <div className="results-controls">
        <label className="field results-sort">Sort results by<select value={sort} onChange={event => setSort(event.target.value as typeof sort)}>
          <option value="price">Lowest combined price</option><option value="airfare">Lowest airfare</option>
          <option value="duration">Shortest outbound flight</option><option value="stops">Fewest outbound stops</option>
        </select><span className="muted small">Flight-only results use airfare when sorting by price.</span></label>
        <AirlineFilter />
      </div>}
      {status === "searching" && !shortlist && (
        <div className="progress">
          <div className="bar" style={{ width: `${pct}%` }} />
          <span>
            {checking ? "Confirming you’re not a robot… (tap the box in the corner if it asks)" : `Checking selected routes and dates… ${pct}%`}
          </span>
        </div>
      )}
      {notices.map((n, i) => (
        <div key={i} className={`notice ${n.level}`}>
          {n.message}
        </div>
      ))}
      {(filterDest || filterDate) && (
        <div className="filters">
          {filterDest && (
            <span className="chip">
              To {cityOf(filterDest)} ({filterDest})<button onClick={() => setFilterDest(null)}>×</button>
            </span>
          )}
          {filterDate && (
            <span className="chip">
              Leaving {shortDate(filterDate)}
              <button onClick={() => setFilterDate(null)}>×</button>
            </span>
          )}
        </div>
      )}
      {shortlist && shortlist.planned > 0 && (
        <section className="combined-results" aria-labelledby="combined-heading">
          <h2 id="combined-heading">Flight + stay</h2>
          <p className="muted small">These starting options assume one location. Open a trip to split your stay across places and dates.</p>
          <p className="muted small" role="status">{status === "searching" && shortlist.checked < shortlist.planned
            ? `Checking stays for ${shortlist.planned} date and destination options…`
            : `${shortlist.quotes.length} combined prices found · ${shortlist.planned} of ${shortlist.eligible} date and destination options shortlisted.`}</p>
          {!!quotes?.length && <ol className="quote-grid">{quotes.map(({ fare, stay }) => (
            <li key={fare.id}>
              <button className="fare quote" onClick={() => void selectFare(fare, stay)}>
                <span className="route">{cityOf(fare.destination)} <small>{fare.destination}</small></span>
                <FareAirlines fare={fare} size={20} />
                <span>{shortDate(fare.departDate)} – {shortDate(fare.returnDate!)}</span>
                <strong className="price">{stay.totalBasis === "nightly-estimate" && "Est. "}{money(fare.price + stay.total)}</strong>
                <span>{money(fare.price)} flight + {money(stay.total)} stay · {travelerCount(adults)}</span>
                <span className="muted">{daysBetween(stay.checkIn, stay.checkOut)} nights · {stay.name}</span>
                <span className="muted">{stopsLabel(fare.stops)} outbound{fare.stops > 0 && ` via ${fare.outbound.slice(0, -1).map(leg => leg.to).join(" → ")}`}</span>
                <span className="muted">{duration(fare.durationMin)} outbound</span>
                {(fare.stale || stay.stale) && <span className="stale">Includes an older price</span>}
              </button>
              <SaveResult fare={fare} stay={stay} />
            </li>
          ))}</ol>}
          {!quotes?.length && status !== "searching" && <p className="muted small">{shortlist.quotes.length
            ? "No shortlisted trips match these filters." : "Lodging prices are unavailable for these options."}</p>}
        </section>
      )}
      {status !== "idle" && <h2 className="airfare-heading">Flight-only results</h2>}
      {status === "done" && list.length === 0 && airlines.length > 0 && fares.length > 0 && <div className="empty">
        <p>No results on the selected airlines.</p>
        <button className="secondary" onClick={() => setRequest({ airlines: [] })}>Show all airlines</button>
      </div>}
      {status === "done" && list.length === 0 && !(airlines.length > 0 && fares.length > 0) && <div className="empty">
        <p>{submitted?.maxStops === 0 ? "No nonstop fares found for these dates and airports." : "No fares found with these search settings."}</p>
        {submitted && submitted.maxStops !== null && <button className="secondary" onClick={() => {
          setRequest({ ...submitted, maxStops: submitted.maxStops === 0 ? 1 : null });
          void runSearch();
        }}>{submitted.maxStops === 0 ? "Search with up to 1 stop" : "Search with any number of stops"}</button>}
      </div>}
      <ol className="fare-list">
        {list.map((f) => (
          <li key={f.id}>
            <button className={`fare ${selected?.id === f.id ? "sel" : ""}`} onClick={() => void selectFare(f)}>
              <div className="fare-main">
                <span className="route">
                  {fareEnds(f).from} → {fareEnds(f).to}
                </span>
                <span className="price">{money(f.price)}</span>
              </div>
              <div className="fare-sub">
                <span>
                  {shortDate(f.departDate)}
                  {f.returnDate && ` – ${shortDate(f.returnDate)}`}
                </span>
                <span>{fareEnds(f).toCity}</span>
              </div>
              <div className="fare-sub muted">
                {f.priceOnly ? <span className="price-only-note">{f.airlines.length ? `${f.airlines.join(" + ")} · ${stopsLabel(f.stops)} · ` : "Lowest price on Google Flights · "}open to see flights</span> : <span className="fare-carrier-line">
                  <FareAirlines fare={f} /> · {stopsLabel(f.stops)} outbound · {duration(f.durationMin)}
                </span>}
                {f.cached && <span className={f.stale ? "stale" : ""}>{f.stale ? "stale · " : ""}{relativeAge(f.fetchedAt)}</span>}
              </div>
              {f.stops > 0 && <div className="fare-sub muted">Via {f.outbound.slice(0, -1).map(leg => `${cityOf(leg.to)} (${leg.to})`).join(" → ")}</div>}
            </button>
            <SaveResult fare={f} />
          </li>
        ))}
      </ol>
      {list.some(fare => fare.provider === "mock") && <p className="muted small">
        Demo connections use <a href="https://openflights.org/data" target="_blank" rel="noreferrer">OpenFlights’ 2014 route data</a>.
      </p>}
    </section>
  );
}

function SaveResult({ fare, stay }: { fare: Fare; stay?: Stay }) {
  const save = useStore(state => state.saveResult);
  const [status, setStatus] = useState("");
  return <div className="result-save"><button className="link" disabled={status === "Saving…" || status === "Saved"} onClick={async () => {
    setStatus("Saving…");
    try { await save(fare, stay); setStatus("Saved"); } catch { setStatus("Could not save. Try again."); }
  }}>{status === "Saved" ? "Saved to My trips" : status === "Saving…" ? status : "Save to shortlist"}</button>
    {status.startsWith("Could") && <span role="alert">{status}</span>}</div>;
}
