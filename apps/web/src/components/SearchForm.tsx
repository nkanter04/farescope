import { CABINS, addDays, todayISO, type Cabin } from "@farescope/shared";
import { useStore } from "../store.ts";
import { PlaceInput } from "./PlaceInput.tsx";

const CABIN_LABEL: Record<Cabin, string> = { economy: "Economy", premium: "Premium economy", business: "Business", first: "First" };

export function SearchForm() {
  const r = useStore((s) => s.request);
  const set = useStore((s) => s.setRequest);
  const run = useStore((s) => s.runSearch);
  const cancel = useStore((s) => s.cancelSearch);
  const status = useStore((s) => s.status);
  const today = todayISO();
  const maxDate = addDays(today, 330); // airlines publish ~11 months out

  return (
    <form
      className="search-form"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <PlaceInput label="From" tokens={r.origins} onChange={(origins) => set({ origins })} placeholder="City, airport, country…" />
      <button
        type="button"
        className="swap"
        aria-label="Swap origin and destination"
        onClick={() => set({ origins: r.destinations, destinations: r.origins })}
      >
        ⇅
      </button>
      <PlaceInput
        label="To"
        tokens={r.destinations}
        onChange={(destinations) => set({ destinations })}
        placeholder="Japan, Europe, Anywhere…"
      />

      <div className="seg" role="radiogroup" aria-label="Trip type">
        {(["roundtrip", "oneway"] as const).map((t) => (
          <button type="button" key={t} role="radio" aria-checked={r.tripType === t} className={r.tripType === t ? "on" : ""} onClick={() => set({ tripType: t })}>
            {t === "roundtrip" ? "Round trip" : "One way"}
          </button>
        ))}
      </div>

      <div className="row">
        <div className="field">
          <label htmlFor="dfrom">Leave between</label>
          <input id="dfrom" type="date" min={today} max={maxDate} value={r.departFrom} onChange={(e) => e.target.value && set({ departFrom: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="dto">and</label>
          <input id="dto" type="date" min={r.departFrom} max={maxDate} value={r.departTo} onChange={(e) => e.target.value && set({ departTo: e.target.value })} />
        </div>
      </div>

      {r.tripType === "roundtrip" && (
        <div className="row">
          <div className="field">
            <label htmlFor="nmin">Trip length (nights)</label>
            <input
              id="nmin"
              type="number"
              min={1}
              max={60}
              value={r.minNights}
              onChange={(e) => {
                const v = Math.max(1, Math.min(60, Number(e.target.value) || 1));
                set({ minNights: v, maxNights: Math.max(v, r.maxNights) });
              }}
            />
          </div>
          <div className="field">
            <label htmlFor="nmax">to</label>
            <input
              id="nmax"
              type="number"
              min={r.minNights}
              max={60}
              value={r.maxNights}
              onChange={(e) => set({ maxNights: Math.max(r.minNights, Math.min(60, Number(e.target.value) || r.minNights)) })}
            />
          </div>
        </div>
      )}

      <div className="row">
        <div className="field">
          <label htmlFor="cabin">Cabin</label>
          <select id="cabin" value={r.cabin} onChange={(e) => set({ cabin: e.target.value as Cabin })}>
            {CABINS.map((c) => (
              <option key={c} value={c}>
                {CABIN_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="stops">Stops</label>
          <select
            id="stops"
            value={r.maxStops ?? "any"}
            onChange={(e) => set({ maxStops: e.target.value === "any" ? null : (Number(e.target.value) as 0 | 1 | 2) })}
          >
            <option value="any">Any</option>
            <option value="0">Nonstop only</option>
            <option value="1">1 stop or fewer</option>
            <option value="2">2 stops or fewer</option>
          </select>
        </div>
        <div className="field narrow">
          <label htmlFor="adults">Travelers</label>
          <input id="adults" type="number" min={1} max={9} value={r.adults} onChange={(e) => set({ adults: Math.max(1, Math.min(9, Number(e.target.value) || 1)) })} />
        </div>
      </div>

      {status === "searching" ? (
        <button type="button" className="primary" onClick={cancel}>
          Stop search
        </button>
      ) : (
        <button type="submit" className="primary" disabled={!r.origins.length || !r.destinations.length}>
          Find the cheapest trips
        </button>
      )}
    </form>
  );
}
