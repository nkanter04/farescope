import { useEffect, useMemo, useState } from "react";
import {
  addDays, creditEstimate, MAX_NIGHTS, MAX_REORDER_STOPS, MAX_START_WINDOW_DAYS, MAX_STOPS, resolvePlace, todayISO,
  type Cabin, type Fare, type ItineraryLeg, type ItineraryOption, type TripPlan,
} from "@farescope/shared";
import { DEMO, fetchFareDetails } from "../api.ts";
import { duration, money, priceColor, shortDate, stopsLabel, travelerCount } from "../format.ts";
import { savePlannedTrip, toRequest, usePlanner, type StopDraft } from "../planner.ts";
import { useStore } from "../store.ts";
import { FareAirlines } from "./AirlineLogo.tsx";
import { BookLinks } from "./BookLinks.tsx";
import { PlaceInput } from "./PlaceInput.tsx";
import { SignUpNudgeSlot } from "../accountSlots.tsx";

const placeName = (token: string) => resolvePlace(token)?.label ?? token;
const credits = (n: number) => `${n} ${n === 1 ? "credit" : "credits"}`;

/** The "Plan a trip" tab: several stops, flexible nights, the cheapest dates (and optionally order). */
export function PlanView() {
  const p = usePlanner();
  const origin = useStore((s) => s.request.origins[0]);
  const live = useStore((s) => s.quota?.live ?? !DEMO);
  const refreshQuota = useStore((s) => s.refreshQuota);
  const today = todayISO();

  // Start from the search's origin (the visitor's nearest airport) until a home is picked.
  useEffect(() => {
    if (!usePlanner.getState().home && origin) usePlanner.getState().set({ home: origin });
  }, [origin]);

  const parsed = useMemo(() => toRequest(p), [p]);
  const estimate = parsed.success ? creditEstimate({ ...parsed.data, reorder: false }, today) : undefined;
  const reorderEstimate = parsed.success && p.stops.length >= 2 && p.stops.length <= MAX_REORDER_STOPS
    ? creditEstimate({ ...parsed.data, reorder: true }, today) : undefined;
  const problem = formProblem(p);
  const n = p.stops.length;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problem) return;
    await p.run();
    if (live) void refreshQuota();
  }

  return <section className="plan-view">
    <header className="plan-head">
      <h1>Plan a trip</h1>
      <p className="muted">Add your stops and how many nights you'd like in each. Tripica prices every flight and finds the cheapest start date and nights.</p>
    </header>
    <div className="plan-grid">
      <form className="card plan-form" onSubmit={submit} aria-label="Trip plan">
        <PlaceInput label="Starting from" tokens={p.home ? [p.home] : []} onChange={(t) => p.set({ home: t.at(-1) ?? "" })} placeholder="City or airport" />

        <ol className="plan-stops">
          {p.stops.map((stop, i) => <StopRow key={stop.id} stop={stop} index={i} canRemove={n > 1} prev={i === 0 ? p.home : p.stops[i - 1].place} />)}
        </ol>
        {n < MAX_STOPS && <button type="button" className="secondary" onClick={p.addStop}>+ Add a stop</button>}

        <fieldset className="plan-end">
          <legend>End the trip</legend>
          <div className="seg" role="group" aria-label="Where the trip ends">
            {([["home", "Back home"], ["last", "At the last stop"], ["place", "Somewhere else"]] as const).map(([v, label]) =>
              <button type="button" key={v} className={p.end === v ? "on" : ""} aria-pressed={p.end === v} onClick={() => p.set({ end: v })}>{label}</button>)}
          </div>
          {p.end === "place" && <PlaceInput label="Final place" tokens={p.endPlace ? [p.endPlace] : []} onChange={(t) => p.set({ endPlace: t.at(-1) ?? "" })} placeholder="City or airport" />}
          {p.end !== "last" && <LegMode mode={p.endMode} cost={p.endCost} label={`Getting ${p.end === "home" ? "home" : "there"}`}
            onMode={(endMode) => p.set({ endMode })} onCost={(endCost) => p.set({ endCost })} />}
        </fieldset>

        <fieldset className="plan-when">
          <legend>First flight leaves between</legend>
          <div className="row">
            <label>From<input type="date" value={p.startFrom} min={today} max={addDays(today, 329)} onChange={(e) => e.target.value && p.set({ startFrom: e.target.value })} /></label>
            <label>To<input type="date" value={p.startTo} min={p.startFrom} max={addDays(p.startFrom, MAX_START_WINDOW_DAYS)} onChange={(e) => e.target.value && p.set({ startTo: e.target.value })} /></label>
          </div>
        </fieldset>

        <div className="row">
          <label>Travelers<select value={p.adults} onChange={(e) => p.set({ adults: Number(e.target.value) })}>
            {[1, 2, 3, 4, 5, 6].map((a) => <option key={a} value={a}>{travelerCount(a)}</option>)}
          </select></label>
          <label>Cabin<select value={p.cabin} onChange={(e) => p.set({ cabin: e.target.value as Cabin })}>
            <option value="economy">Economy</option><option value="premium_economy">Premium economy</option><option value="business">Business</option><option value="first">First</option>
          </select></label>
        </div>

        {n >= 2 && <label className="plan-reorder">
          <input type="checkbox" checked={p.reorder && n <= MAX_REORDER_STOPS} disabled={n > MAX_REORDER_STOPS} onChange={(e) => p.set({ reorder: e.target.checked })} />
          <span>
            <strong>Try other orders</strong> to find a cheaper route
            <small className="muted">{n > MAX_REORDER_STOPS ? `Works with up to ${MAX_REORDER_STOPS} stops.`
              : live && reorderEstimate !== undefined && estimate !== undefined ? `Uses more credits: up to ${credits(reorderEstimate)} instead of ${estimate}, because every pair of stops gets priced.`
              : "Prices every pair of stops. Free here (simulated prices); with live prices it uses more credits."}</small>
          </span>
        </label>}

        {problem && <p className="muted plan-problem">{problem}</p>}
        <button className="primary" disabled={!!problem || p.status === "planning"}>
          {p.status === "planning" ? "Pricing your trip…" : "Find the cheapest dates"}
        </button>
        {live && parsed.success && <p className="muted plan-cost">
          Uses up to {credits(creditEstimate(parsed.data, today))} (one per flight; prices you've already looked up are free).
        </p>}
      </form>
      <PlanResults />
    </div>
  </section>;
}

function StopRow({ stop, index, canRemove, prev }: { stop: StopDraft; index: number; canRemove: boolean; prev: string }) {
  const { setStop, removeStop } = usePlanner();
  const nights = Array.from({ length: MAX_NIGHTS }, (_, i) => i + 1);
  return <li className="plan-stop">
    <LegMode mode={stop.mode} cost={stop.ownCost} label={`Getting here${prev ? ` from ${placeName(prev)}` : ""}`}
      onMode={(mode) => setStop(stop.id, { mode })} onCost={(ownCost) => setStop(stop.id, { ownCost })} />
    <div className="plan-stop-body">
      <PlaceInput label={`Stop ${index + 1}`} tokens={stop.place ? [stop.place] : []} onChange={(t) => setStop(stop.id, { place: t.at(-1) ?? "" })} placeholder="City or airport" />
      <div className="row plan-nights">
        <label>Nights, at least<select value={stop.minNights} onChange={(e) => { const v = Number(e.target.value); setStop(stop.id, { minNights: v, maxNights: Math.max(v, stop.maxNights) }); }}>
          {nights.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>at most<select value={stop.maxNights} onChange={(e) => { const v = Number(e.target.value); setStop(stop.id, { maxNights: v, minNights: Math.min(v, stop.minNights) }); }}>
          {nights.map((x) => <option key={x}>{x}</option>)}</select></label>
      </div>
      {canRemove && <button type="button" className="link" onClick={() => removeStop(stop.id)}>Remove stop</button>}
    </div>
  </li>;
}

function LegMode({ mode, cost, label, onMode, onCost }: { mode: "fly" | "own"; cost: string; label: string; onMode(m: "fly" | "own"): void; onCost(c: string): void }) {
  return <div className="plan-leg-mode">
    <span className="muted">{label}</span>
    <div className="seg" role="group" aria-label={label}>
      <button type="button" className={mode === "fly" ? "on" : ""} aria-pressed={mode === "fly"} onClick={() => onMode("fly")}>Fly</button>
      <button type="button" className={mode === "own" ? "on" : ""} aria-pressed={mode === "own"} onClick={() => onMode("own")}>My own way</button>
    </div>
    {mode === "own" && <label className="plan-own-cost">Cost (train, bus, car)
      <input type="number" inputMode="decimal" min={0} step={1} placeholder="0" value={cost} onChange={(e) => onCost(e.target.value)} />
    </label>}
  </div>;
}

/** What's still missing before the plan can run, in plain words. */
function formProblem(p: ReturnType<typeof usePlanner.getState>): string | undefined {
  if (!p.home) return "Pick where you're starting from.";
  if (p.stops.some((s) => !s.place)) return "Pick a place for every stop.";
  if (p.end === "place" && !p.endPlace) return "Pick where the trip ends.";
  if (p.startTo < p.startFrom) return "The start window ends before it begins.";
  const parsed = toRequest(p);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Check the plan.";
  return undefined;
}

function PlanResults() {
  const { status, response, submitted } = usePlanner();
  const [pick, setPick] = useState(0);
  useEffect(() => setPick(0), [response]);
  if (status === "idle") return <div className="plan-results plan-empty card">
    <h2>How it works</h2>
    <ol>
      <li>Each flight between your stops is priced for every day it could happen.</li>
      <li>Tripica tries every start date and every number of nights in your ranges, and keeps the cheapest total.</li>
      <li>Open any flight to see real itineraries, then book each one directly.</li>
    </ol>
  </div>;
  if (status === "planning") return <div className="plan-results card" role="status"><span className="spinner" aria-hidden /> Pricing every flight on every possible date…</div>;
  if (!response || !submitted) return null;
  const options = response.result?.best ? [response.result.best, ...response.result.alternatives] : [];
  const option = options[pick] ?? options[0];
  return <div className="plan-results" aria-live="polite">
    {response.error && <p className="notice warn" role="alert">{response.error}</p>}
    {response.notices.map((notice) => <p key={notice} className="notice">{notice}</p>)}
    {option && <>
      <div className="card plan-total">
        <div>
          <span className="muted">{pick === 0 ? "Cheapest plan" : `Option ${pick + 1}`}</span>
          <strong className="price">{money(option.total)}</strong>
          <span className="muted">flights{option.legs.some((l) => l.mode === "ground") ? " + your own travel" : ""} · {travelerCount(submitted.adults)}</span>
        </div>
        <p>{shortDate(option.start)} – {shortDate(option.end)} · {option.stays.reduce((s, x) => s + x.nights, 0)} nights</p>
        {response.creditsUsed > 0 && <p className="muted">Used {credits(response.creditsUsed)}.</p>}
        <SaveButton key={`${option.start}-${option.order.join()}`} option={option} />
      </div>
      <StartStrip byStart={response.result?.byStart ?? []} chosen={option.start} />
      <PlanTimeline option={option} airports={response.airports} />
      {options.length > 1 && <section className="card plan-alts" aria-label="Other plans">
        <h2>Other options</h2>
        <ul>
          {options.map((o, i) => <li key={`${o.start}-${o.order.join()}`}>
            <button className={i === pick ? "on" : ""} aria-pressed={i === pick} onClick={() => setPick(i)}>
              <strong>{money(o.total)}</strong>
              <span>{shortDate(o.start)} · {o.order.map((k) => placeName(o.stays.find((s) => s.node === k)?.place ?? "")).join(" → ")}</span>
            </button>
          </li>)}
        </ul>
      </section>}
      <p className="muted plan-footnote">
        {DEMO ? "Simulated prices. " : "Prices are the lowest one-way fares Google Flights showed for each day; real itineraries can cost a little more. "}
        Stays aren't included; add them after you save the trip.
      </p>
    </>}
  </div>;
}

function SaveButton({ option }: { option: ItineraryOption }) {
  const [state, setState] = useState<{ status: "idle" | "saving" | "saved" | "error"; message?: string; trip?: TripPlan }>({ status: "idle" });
  const openTrip = useStore((s) => s.openTrip);
  if (state.status === "saved" && state.trip) {
    const trip = state.trip;
    return <><p className="plan-saved" role="status">Saved to My trips. <button className="link" onClick={() => openTrip(trip)}>Add stays →</button></p><SignUpNudgeSlot place="save" /></>;
  }
  return <div className="plan-save">
    <button className="primary" disabled={state.status === "saving"} onClick={async () => {
      setState({ status: "saving" });
      try { setState({ status: "saved", trip: await savePlannedTrip(option) }); }
      catch (e) { setState({ status: "error", message: (e as Error).message }); }
    }}>{state.status === "saving" ? "Saving…" : "Save to My trips"}</button>
    {state.status === "error" && <p className="notice warn" role="alert">{state.message}</p>}
  </div>;
}

/** "06:31 → 03:00+1": local times, with how many days later it lands. */
function flightTimes(f: Fare) {
  const dep = f.outbound[0]?.depart ?? "";
  const arr = f.outbound.at(-1)?.arrive ?? "";
  const days = dep && arr ? Math.round((Date.parse(`${arr.slice(0, 10)}T00:00:00Z`) - Date.parse(`${dep.slice(0, 10)}T00:00:00Z`)) / 86_400_000) : 0;
  return <>{dep.slice(11)} → {arr.slice(11)}{days > 0 && <sup>+{days}</sup>}</>;
}

/** Best total for each possible first-flight date, like the price calendar. */
function StartStrip({ byStart, chosen }: { byStart: { date: string; total: number }[]; chosen: string }) {
  if (byStart.length < 2) return null;
  const min = Math.min(...byStart.map((d) => d.total));
  const max = Math.max(...byStart.map((d) => d.total));
  return <section className="card plan-starts" aria-label="Total by start date">
    <h2>Total by start date</h2>
    <ol>
      {byStart.map((d) => <li key={d.date} className={`${d.date === chosen ? "chosen" : ""} ${d.total === min ? "cheapest" : ""}`}
        title={`${shortDate(d.date)}: ${money(d.total)}`}
        style={{ background: priceColor(max === min ? 0 : (d.total - min) / (max - min), 0.22) }}>
        <small>{shortDate(d.date).replace(/^\w+, /, "")}</small>
        <strong>{money(d.total)}</strong>
      </li>)}
    </ol>
  </section>;
}

function PlanTimeline({ option, airports }: { option: ItineraryOption; airports: Record<number, string> }) {
  const adults = usePlanner((s) => s.submitted?.adults ?? 1);
  const items: React.ReactNode[] = [];
  option.legs.forEach((leg, i) => {
    items.push(<LegItem key={`leg-${leg.from}-${leg.to}-${leg.date}`} leg={leg} airports={airports} />);
    const stay = option.stays[i];
    if (stay) items.push(<li key={`stay-${i}`} className="plan-stay">
      <strong>{placeName(stay.place)}</strong>
      <span>{stay.nights} {stay.nights === 1 ? "night" : "nights"} · {shortDate(stay.checkIn)} – {shortDate(stay.checkOut)}</span>
      <BookLinks kind="stay" ctx={{ city: placeName(stay.place), checkIn: stay.checkIn, checkOut: stay.checkOut, adults }} />
    </li>);
  });
  return <section className="card plan-route" aria-label="Plan">
    <h2>Your route</h2>
    <ol className="timeline">{items}</ol>
  </section>;
}

function LegItem({ leg, airports }: { leg: ItineraryLeg; airports: Record<number, string> }) {
  const submitted = usePlanner((s) => s.submitted);
  const [flights, setFlights] = useState<{ status: "idle" | "loading" | "done"; fares: Fare[]; error?: string }>({ status: "idle", fares: [] });
  const from = airports[leg.from];
  const to = airports[leg.to];
  const note = (node: number, place: string) => {
    const p = resolvePlace(place);
    return p && p.airports.length > 1 ? `${placeName(place)} prices from ${airports[node]}` : "";
  };
  const airportNote = [note(leg.from, leg.fromPlace), note(leg.to, leg.toPlace)].filter(Boolean).join(" · ");
  if (leg.mode === "ground") return <li className="plan-leg ground">
    <strong>{placeName(leg.fromPlace)} → {placeName(leg.toPlace)}</strong>
    <span>Your own way · {shortDate(leg.date)} · {money(leg.price)}</span>
  </li>;

  async function load() {
    if (!submitted) return;
    setFlights({ status: "loading", fares: [] });
    const grid: Fare = {
      id: `plan-${from}-${to}-${leg.date}`, provider: "plan", origin: from, destination: to, departDate: leg.date, price: leg.price,
      currency: "USD", airlines: [], stops: 0, durationMin: 0, outbound: [], fetchedAt: new Date().toISOString(), cached: false, priceOnly: true,
    };
    const r = await fetchFareDetails(grid, { cabin: submitted.cabin, maxStops: submitted.maxStops ?? null, adults: submitted.adults })
      .catch((e: Error) => ({ fares: [] as Fare[], error: e.message }));
    setFlights({ status: "done", fares: r.fares.slice(0, 4), error: r.error });
  }

  return <li className="plan-leg">
    <strong>{placeName(leg.fromPlace)} → {placeName(leg.toPlace)}</strong>
    <span>Fly {from} → {to} · {shortDate(leg.date)} · from {money(leg.price)}</span>
    {airportNote && <small className="muted">{airportNote}</small>}
    <div className="plan-leg-actions">
      {flights.status === "idle" && <button className="secondary" onClick={() => void load()}>See flights{DEMO ? "" : " (1 credit)"}</button>}
      <BookLinks kind="flight" ctx={{ origin: from, destination: to, depart: leg.date, adults: submitted?.adults }} />
    </div>
    {flights.status === "loading" && <p role="status" className="muted"><span className="spinner" aria-hidden /> Loading flights…</p>}
    {flights.status === "done" && (flights.error
      ? <p className="notice warn" role="alert">{flights.error}</p>
      : flights.fares.length === 0 ? <p className="muted">No flights found for this day.</p>
      : <ul className="plan-flights">
        {flights.fares.map((f) => <li key={f.id}>
          <FareAirlines fare={f} />
          <span className="pf-times">{flightTimes(f)} · {duration(f.durationMin)} · {stopsLabel(f.stops)}</span>
          <strong className="pf-price">{money(f.price)}</strong>
          {f.bookingUrl && <a className="book-btn" data-booking-kind="flight" href={f.bookingUrl} target="_blank" rel="noreferrer sponsored">Book ↗</a>}
        </li>)}
      </ul>)}
  </li>;
}
