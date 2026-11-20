import { useState } from "react";
import { carrierFrom, codeFromFlightNumber, type Cabin, type Fare, type ReturnOption } from "@farescope/shared";
import { fetchReturns } from "../api.ts";
import { duration, money, stopsLabel } from "../format.ts";
import { useStore } from "../store.ts";
import { AirlineLogo } from "./AirlineLogo.tsx";

const time = (stamp: string) => stamp.slice(11, 16);

/**
 * The return half of a round trip. Loaded on request (a live lookup costs a credit), from the
 * outbound flight's provider token. Each option's price is the round-trip total with that return.
 */
export function ReturnFlights({ fare, cabin, adults }: { fare: Fare; cabin: Cabin; adults: number }) {
  const live = useStore((s) => s.quota?.live ?? false);
  const maxStops = useStore((s) => s.submitted?.maxStops ?? null);
  const [state, setState] = useState<{ status: "idle" | "loading" | "done"; options: ReturnOption[]; error?: string }>({ status: "idle", options: [] });
  if (!fare.returnDate) return null;
  if (!fare.returnToken) return <p className="muted small">Round-trip airfare. Return flight details are available with the supplier.</p>;

  const load = async () => {
    setState({ status: "loading", options: [] });
    const r = await fetchReturns(fare, { cabin, maxStops, adults }).catch((e: Error) => ({ options: [], error: e.message }));
    setState({ status: "done", options: r.options.slice(0, 5), error: r.error });
  };

  return (
    <section className="returns" aria-label="Return flight">
      {state.status === "idle" && (
        <p className="returns-cta">
          <span className="muted small">Round-trip airfare.</span>{" "}
          <button className="link" onClick={() => void load()}>Show return flights{live ? " (uses 1 credit)" : ""}</button>
        </p>
      )}
      {state.status === "loading" && <p className="muted small" role="status">Loading return flights…</p>}
      {state.status === "done" && (
        <>
          <h4>Return flights · {fare.returnDate}</h4>
          {state.error && <p className="notice warn">{state.error}</p>}
          {!state.error && !state.options.length && <p className="muted small">No return flights found for this outbound flight. Check with the airline.</p>}
          <ol className="return-list">
            {state.options.map((o, i) => (
              <li key={i}>
                <span className="return-airlines">
                  {o.legs.map((l, j) => (
                    <AirlineLogo key={j} carrier={carrierFrom(l.airline, l.airlineCode ?? codeFromFlightNumber(l.flightNumber), l.airlineLogo)} size={18} />
                  ))}
                  <span>{o.airlines.join(" + ")}</span>
                </span>
                <span>{time(o.legs[0].depart)} → {time(o.legs.at(-1)!.arrive)} · {stopsLabel(o.stops)}{o.stops > 0 && ` via ${o.legs.slice(0, -1).map((l) => l.to).join(", ")}`} · {duration(o.durationMin)}</span>
                <span className="return-price">
                  {o.price === fare.price ? "Included" : `${o.price > fare.price ? "+" : "−"}${money(Math.abs(o.price - fare.price))}`}
                  <small className="muted"> round trip {money(o.price)}</small>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
