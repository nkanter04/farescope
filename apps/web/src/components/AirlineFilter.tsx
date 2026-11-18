import { useMemo } from "react";
import { ALLIANCE_NAMES, fareCarriers, findAirline, type Alliance, type Carrier, carrierFrom } from "@farescope/shared";
import { money } from "../format.ts";
import { ANY_AIRLINE, useStore } from "../store.ts";
import { AirlineLogo } from "./AirlineLogo.tsx";

interface Row {
  carrier: Carrier;
  count: number;
  cheapest: number;
}

/**
 * "Airlines" filter: shows every airline in the current results with its logo and cheapest fare.
 * The selection filters these results instantly and is sent with the next search, so live searches
 * only fetch the chosen airlines.
 */
export function AirlineFilter() {
  const fares = useStore((s) => s.fares);
  const selected = useStore((s) => s.request.airlines ?? ANY_AIRLINE);
  const submitted = useStore((s) => s.submitted);
  const setRequest = useStore((s) => s.setRequest);
  const runSearch = useStore((s) => s.runSearch);
  const status = useStore((s) => s.status);

  const rows = useMemo(() => {
    const byCode = new Map<string, Row>();
    for (const fare of fares) {
      for (const c of fareCarriers(fare)) {
        const row = byCode.get(c.code) ?? { carrier: c, count: 0, cheapest: Infinity };
        row.count++;
        row.cheapest = Math.min(row.cheapest, fare.price);
        byCode.set(c.code, row);
      }
    }
    // Keep selected airlines listed even if the current results don't include them.
    for (const code of selected) if (!byCode.has(code)) byCode.set(code, { carrier: carrierFrom(findAirline(code)?.name ?? code, code), count: 0, cheapest: Infinity });
    return [...byCode.values()].sort((a, b) => a.cheapest - b.cheapest || a.carrier.name.localeCompare(b.carrier.name));
  }, [fares, selected]);

  const alliances = (Object.keys(ALLIANCE_NAMES) as Alliance[]).filter((al) => rows.some((r) => r.carrier.alliance === al));
  const set = (airlines: string[]) => setRequest({ airlines: [...new Set(airlines)].sort() });
  const toggle = (code: string) => {
    // From "all airlines", unticking one keeps every other airline in the results.
    const base = selected.length ? selected : rows.map((r) => r.carrier.code);
    set(base.includes(code) ? base.filter((c) => c !== code) : [...base, code]);
  };
  const isOn = (code: string) => !selected.length || selected.includes(code);
  const allianceOn = (al: Alliance) => {
    const codes = rows.filter((r) => r.carrier.alliance === al).map((r) => r.carrier.code);
    return selected.length > 0 && codes.length > 0 && codes.every((c) => selected.includes(c)) && selected.length === codes.length;
  };
  // Results came from a narrower airline search than what's now selected.
  const widened =
    status !== "searching" && !!submitted?.airlines?.length && (!selected.length || selected.some((c) => !submitted.airlines.includes(c)));

  if (!rows.length) return null;
  const summary = !selected.length
    ? "All airlines"
    : selected.length === 1
      ? rows.find((r) => r.carrier.code === selected[0])?.carrier.name ?? selected[0]
      : `${selected.length} airlines`;

  return (
    <details className="airline-filter">
      <summary>
        <span className="muted small">Airlines</span>
        <span className="filter-value">
          {selected.length > 0 && selected.length <= 3 && (
            <span className="logo-stack">
              {selected.map((code) => {
                const row = rows.find((r) => r.carrier.code === code);
                return row ? <AirlineLogo key={code} carrier={row.carrier} size={18} label /> : null;
              })}
            </span>
          )}
          {summary}
        </span>
      </summary>
      <div className="airline-panel">
        <div className="alliance-row" role="group" aria-label="Quick filters">
          <button type="button" className={`chip-btn ${!selected.length ? "on" : ""}`} onClick={() => set([])}>All airlines</button>
          {alliances.map((al) => (
            <button key={al} type="button" className={`chip-btn ${allianceOn(al) ? "on" : ""}`}
              onClick={() => set(rows.filter((r) => r.carrier.alliance === al).map((r) => r.carrier.code))}>
              {ALLIANCE_NAMES[al]}
            </button>
          ))}
        </div>
        <ul className="airline-options">
          {rows.map(({ carrier, count, cheapest }) => (
            <li key={carrier.code}>
              <label>
                <input type="checkbox" checked={isOn(carrier.code)} onChange={() => toggle(carrier.code)} />
                <AirlineLogo carrier={carrier} size={28} label />
                <span className="airline-name">
                  {carrier.name}
                  <span className="muted small">{carrier.alliance ? ALLIANCE_NAMES[carrier.alliance] : "Independent"} · {count} {count === 1 ? "fare" : "fares"}</span>
                </span>
                <span className="price small">{Number.isFinite(cheapest) ? `from ${money(cheapest)}` : "—"}</span>
              </label>
              <button type="button" className="link only" onClick={() => set([carrier.code])} aria-label={`Only ${carrier.name}`}>Only</button>
            </li>
          ))}
        </ul>
        <p className="muted small">Itineraries are shown when every flight is on a selected airline. Your choice also applies to your next search.</p>
        {widened && (
          <button type="button" className="secondary" onClick={() => void runSearch()}>Search again to include more airlines</button>
        )}
      </div>
    </details>
  );
}
