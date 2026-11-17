import { useDerived } from "../derived.ts";
import { cityOf, duration, money, relativeAge, shortDate, stopsLabel } from "../format.ts";
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
  const { list } = useDerived();

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <section className="results">
      {status === "searching" && (
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
