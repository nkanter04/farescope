import { useEffect, useMemo, useRef, useState } from "react";
import { AIRPORT_BY_IATA, MONTH_NAMES, resolvePlace, todayISO, type Fare, type SearchEvent } from "@farescope/shared";
import { DEMO, streamSearch } from "../api.ts";
import { cheapestByCity, exploreMonths, exploreRequest, MONTH_INDEX, type ExploreDeal, type ExploreMonth } from "../explore/explore.ts";
import { money, shortDate, travelerCount } from "../format.ts";
import { useStore } from "../store.ts";
import { guideForAirport } from "../urlSearch.ts";

interface MonthResult { status: "loading" | "done" | "error"; fares: Fare[]; message?: string }

/** Results survive switching months or opening a search and coming back (per origin, travelers and month). */
const resultCache = new Map<string, MonthResult>();

const LABEL_CLASS: Record<string, string> = {
  "Best value": "good", "Shoulder season": "mid", "Peak season": "busy", "Off-season": "off",
};

/** Home page before any search: the cheapest places to fly from your origin, month by month. */
export function ExploreHome() {
  const origin = useStore((s) => s.request.origins[0] ?? "AUS");
  const adults = useStore((s) => s.request.adults);
  const quota = useStore((s) => s.quota);
  const months = useMemo(() => exploreMonths(todayISO(), 6), []);
  const [monthKey, setMonthKey] = useState(() => months[Math.min(2, months.length - 1)]?.key ?? "");
  const month = months.find((m) => m.key === monthKey) ?? months[0];
  const cacheKey = `${origin}|${adults}|${month?.key}`;
  const [result, setResult] = useState<MonthResult | undefined>(() => resultCache.get(cacheKey));
  const controller = useRef<AbortController | null>(null);
  // Live providers spend quota, so only run automatically on simulated data.
  const live = !DEMO && quota?.live !== false;
  const originPlace = resolvePlace(origin);
  const originLabel = originPlace?.label ?? origin;
  const homeCountry = originPlace?.airports.map((a) => AIRPORT_BY_IATA[a]?.country).find(Boolean);
  const [scope, setScope] = useState<"abroad" | "all">("abroad");

  function run(m: ExploreMonth) {
    controller.current?.abort();
    const ctl = new AbortController();
    controller.current = ctl;
    const key = `${origin}|${adults}|${m.key}`;
    const fares: Fare[] = [];
    let raf = 0;
    const publish = (status: MonthResult["status"], message?: string) => {
      const r = { status, fares: [...fares], message };
      if (status !== "loading") resultCache.set(key, r);
      if (!ctl.signal.aborted) setResult(r);
    };
    setResult({ status: "loading", fares: [] });
    const onEvent = (e: SearchEvent) => {
      if (e.type === "fare") {
        fares.push(e.fare);
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; publish("loading"); });
      } else if (e.type === "error") {
        publish("error", e.message);
      }
    };
    streamSearch(exploreRequest(origin, m, adults), onEvent, ctl.signal)
      .then(() => { cancelAnimationFrame(raf); if (!ctl.signal.aborted) publish("done"); })
      .catch((err: unknown) => { if (!ctl.signal.aborted) publish("error", err instanceof Error ? err.message : "Search failed"); });
  }

  useEffect(() => {
    if (!month) return;
    const cached = resultCache.get(cacheKey);
    setResult(cached);
    if (!cached && !live) run(month);
    return () => controller.current?.abort();
  }, [cacheKey, live]);

  function openDeal(deal: ExploreDeal) {
    if (!month) return;
    const store = useStore.getState();
    store.setRequest({ destinations: [deal.token], departFrom: month.departFrom, departTo: month.departTo, tripType: "roundtrip", minNights: 5, maxNights: 9 });
    void store.runSearch();
  }

  const deals = useMemo(() => cheapestByCity(result?.fares ?? [], 12, scope === "abroad" ? homeCountry : undefined), [result, scope, homeCountry]);
  if (!month) return null;
  return (
    <section className="explore" aria-labelledby="explore-title">
      <header className="explore-head">
        <h1 id="explore-title">Where can you go from {originLabel}?</h1>
        <p className="muted">
          The cheapest round trips we found for 5–9 nights, {travelerCount(adults)}.{" "}
          {DEMO || quota?.live === false ? <strong className="demo-note">Demo prices are simulated.</strong> : null}
        </p>
      </header>
      <div className="explore-controls">
      {homeCountry && (
        <div className="seg explore-scope" role="group" aria-label="Destinations">
          <button className={scope === "abroad" ? "on" : ""} aria-pressed={scope === "abroad"} onClick={() => setScope("abroad")}>Abroad</button>
          <button className={scope === "all" ? "on" : ""} aria-pressed={scope === "all"} onClick={() => setScope("all")}>Everywhere</button>
        </div>
      )}
      <div className="explore-months" role="group" aria-label="Departure month">
        {months.map((m) => (
          <button key={m.key} className={`chip-btn ${m.key === month.key ? "on" : ""}`} aria-pressed={m.key === month.key} onClick={() => setMonthKey(m.key)}>
            {MONTH_NAMES[m.month - 1].slice(0, 3)}{m.year !== months[0].year ? ` ${m.year}` : ""}
          </button>
        ))}
      </div>
      </div>

      {!result && live && (
        <div className="explore-empty">
          <p>Each look costs a few live price searches, so we only run it when you ask.</p>
          <button className="primary" onClick={() => run(month)}>Show the cheapest places in {MONTH_NAMES[month.month - 1]}</button>
        </div>
      )}
      {result?.status === "error" && <p className="notice error" role="alert">{result.message ?? "Search failed."} <button className="link" onClick={() => run(month)}>Try again</button></p>}
      {result?.status === "loading" && !deals.length && <p role="status" className="muted">Searching every destination in {MONTH_NAMES[month.month - 1]}…</p>}
      {result?.status === "done" && !deals.length && <p className="muted">No fares found for {MONTH_NAMES[month.month - 1]} yet. Try another month.</p>}

      {deals.length > 0 && (
        <ol className="explore-grid" aria-busy={result?.status === "loading"}>
          {deals.map((deal, i) => {
            const guide = guideForAirport(deal.fare.destination);
            const label = guide ? MONTH_INDEX[guide.slug]?.labels[month.month - 1] : undefined;
            return (
              <li key={deal.token} className="explore-card">
                <button className="explore-open" onClick={() => openDeal(deal)} aria-label={`Search ${deal.city} in ${MONTH_NAMES[month.month - 1]}, from ${money(deal.fare.price)}`}>
                  <span className="rank" aria-hidden>{i + 1}</span>
                  <span className="where"><strong>{deal.city}</strong><span className="muted">{deal.countryName}</span></span>
                  <span className="from"><span className="muted">from</span> <strong>{money(deal.fare.price)}</strong></span>
                  <span className="when muted">{shortDate(deal.fare.departDate)}{deal.fare.returnDate ? ` – ${shortDate(deal.fare.returnDate)}` : ""} · {deal.fare.origin}→{deal.fare.destination}</span>
                </button>
                {guide && (
                  <a className="explore-guide" href={`guides/${guide.slug}/`}>
                    {label && <span className={`season ${LABEL_CLASS[label] ?? ""}`}>{label}</span>}
                    When to visit {guide.name} →
                  </a>
                )}
              </li>
            );
          })}
        </ol>
      )}
      {deals.length > 0 && <p className="small muted">Tap a destination to compare every date and trip length in {MONTH_NAMES[month.month - 1]}. Season labels come from our guides (weather and holidays), not prices.</p>}
    </section>
  );
}
