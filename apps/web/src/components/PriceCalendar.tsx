import { addDays, parseISODate } from "@farescope/shared";
import { useDerived } from "../derived.ts";
import { money, priceColor } from "../format.ts";
import { useStore } from "../store.ts";

/** Month grids of the cheapest fare per departure day, plus cheapest per trip length. */
export function PriceCalendar() {
  const req = useStore((s) => s.submitted ?? s.request);
  const filterDate = useStore((s) => s.filterDate);
  const setFilterDate = useStore((s) => s.setFilterDate);
  const status = useStore((s) => s.status);
  const { byDay, byNights, dayMin, dayMax } = useDerived();

  if (byDay.size === 0) {
    return <div className="calendar empty">{status === "searching" ? "Filling the calendar…" : "Run a search to see a price calendar."}</div>;
  }

  // Build month blocks from departFrom to departTo.
  const months: { key: string; label: string; days: (string | null)[] }[] = [];
  let d = req.departFrom;
  while (d <= req.departTo) {
    const dt = parseISODate(d);
    const key = d.slice(0, 7);
    const first = `${key}-01`;
    const lead = parseISODate(first).getUTCDay();
    const days: (string | null)[] = Array(lead).fill(null);
    let x = first;
    while (x.slice(0, 7) === key) {
      days.push(x);
      x = addDays(x, 1);
    }
    months.push({ key, label: dt.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }), days });
    d = x;
  }

  const span = Math.max(1, dayMax - dayMin);
  const nightsEntries = [...byNights.entries()].sort((a, b) => a[0] - b[0]);
  const nMin = Math.min(...nightsEntries.map((e) => e[1]));
  const nSpan = Math.max(1, Math.max(...nightsEntries.map((e) => e[1])) - nMin);

  return (
    <div className="calendar">
      <div className="cal-head">
        <h2>Lowest airfare found by departure day</h2>
        {filterDate && (
          <button className="link" onClick={() => setFilterDate(null)}>
            Clear day filter
          </button>
        )}
      </div>
      <div className="months">
        {months.map((m) => (
          <div className="month" key={m.key}>
            <div className="month-label">{m.label}</div>
            <div className="dow">
              {["S", "M", "T", "W", "T", "F", "S"].map((x, i) => (
                <span key={i}>{x}</span>
              ))}
            </div>
            <div className="grid">
              {m.days.map((day, i) => {
                if (!day) return <span key={`b${i}`} />;
                const cell = byDay.get(day);
                const inRange = day >= req.departFrom && day <= req.departTo;
                const t = cell ? (cell.price - dayMin) / span : 0;
                const cheapest = !!cell && cell.price === dayMin;
                return (
                  <button
                    key={day}
                    className={`day ${cell ? "has" : ""} ${cheapest ? "cheapest" : ""} ${filterDate === day ? "sel" : ""} ${inRange ? "" : "out"}`}
                    style={cell ? { background: priceColor(t, 0.28), borderColor: priceColor(t, 0.7) } : undefined}
                    disabled={!cell}
                    aria-label={cell ? `${day}, airfare ${money(cell.price)}${cheapest ? ", cheapest day" : ""}` : day}
                    aria-pressed={filterDate === day}
                    title={cell ? `${money(cell.price)}${cell.nights ? ` · ${cell.nights} nights` : ""}` : undefined}
                    onClick={() => setFilterDate(filterDate === day ? null : day)}
                  >
                    <span className="dnum">{Number(day.slice(8))}</span>
                    {cheapest && <span className="dbest" aria-hidden>Cheapest</span>}
                    {cell && <span className="dprice">{cell.price >= 10000 ? `${Math.round(cell.price / 1000)}k` : `$${cell.price}`}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {nightsEntries.length > 1 && (
        <div className="nights">
          <span className="muted">Cheapest by trip length:</span>
          {nightsEntries.map(([n, p]) => (
            <span key={n} className="npill" style={{ borderColor: priceColor((p - nMin) / nSpan, 0.8) }}>
              {n}n · {money(p)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
