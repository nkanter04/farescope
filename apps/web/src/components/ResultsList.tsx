import { daysBetween } from "@farescope/shared";
import { useDerived } from "../derived.ts";
import { cityOf, duration, money, relativeAge, shortDate, stopsLabel, travelerCount } from "../format.ts";
import { useStore } from "../store.ts";

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
  const quotes = shortlist?.quotes.filter(({ fare }) =>
    (!filterDest || fare.destination === filterDest) && (!filterDate || fare.departDate === filterDate));
  const { list } = useDerived();

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <section className="results">
      {status === "searching" && !shortlist && (
        <div className="progress">
          <div className="bar" style={{ width: `${pct}%` }} />
          <span>
            Checking selected routes and dates… {pct}%
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
          <p className="muted small" role="status">{status === "searching" && shortlist.checked < shortlist.planned
            ? `Checking stays for ${shortlist.planned} date and destination options…`
            : `${shortlist.quotes.length} combined prices found · ${shortlist.planned} of ${shortlist.eligible} date and destination options shortlisted.`}</p>
          {!!quotes?.length && <ol className="quote-grid">{quotes.map(({ fare, stay }) => (
            <li key={fare.id}>
              <button className="fare quote" onClick={() => void selectFare(fare, stay)}>
                <span className="route">{cityOf(fare.destination)} <small>{fare.destination}</small></span>
                <span>{shortDate(fare.departDate)} – {shortDate(fare.returnDate!)}</span>
                <strong className="price">{stay.totalBasis === "nightly-estimate" && "Est. "}{money(fare.price + stay.total)}</strong>
                <span>{money(fare.price)} flight + {money(stay.total)} stay · {travelerCount(adults)}</span>
                <span className="muted">{daysBetween(stay.checkIn, stay.checkOut)} nights · {stay.name}</span>
                {(fare.stale || stay.stale) && <span className="stale">Includes an older price</span>}
              </button>
            </li>
          ))}</ol>}
          {!quotes?.length && status !== "searching" && <p className="muted small">{shortlist.quotes.length
            ? "No shortlisted trips match these filters." : "Lodging prices are unavailable for these options."}</p>}
        </section>
      )}
      {status !== "idle" && <h2 className="airfare-heading">Flight-only results</h2>}
      {status === "done" && list.length === 0 && <div className="empty">No fares found. Try a wider date window or more destinations.</div>}
      <ol className="fare-list">
        {list.map((f) => (
          <li key={f.id}>
            <button className={`fare ${selected?.id === f.id ? "sel" : ""}`} onClick={() => void selectFare(f)}>
              <div className="fare-main">
                <span className="route">
                  {f.origin} → {f.destination}
                </span>
                <span className="price">{money(f.price)}</span>
              </div>
              <div className="fare-sub">
                <span>
                  {shortDate(f.departDate)}
                  {f.returnDate && ` – ${shortDate(f.returnDate)}`}
                </span>
                <span>{cityOf(f.destination)}</span>
              </div>
              <div className="fare-sub muted">
                <span>
                  {f.airlines.join(", ")} · {stopsLabel(f.stops)} · {duration(f.durationMin)}
                </span>
                {f.cached && <span className={f.stale ? "stale" : ""}>{f.stale ? "stale · " : ""}{relativeAge(f.fetchedAt)}</span>}
              </div>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
