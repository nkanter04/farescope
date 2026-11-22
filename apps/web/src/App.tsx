import { SITE_ROOT } from "./site.ts";
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { resolvePlace, todayISO } from "@farescope/shared";
import { FareDetailsLoader, FarePanel } from "./components/FarePanel.tsx";
import { PriceCalendar } from "./components/PriceCalendar.tsx";
import { ResultsList } from "./components/ResultsList.tsx";
import { SearchForm } from "./components/SearchForm.tsx";
import { ExploreHome } from "./components/ExploreHome.tsx";
import { TripsView } from "./components/TripsView.tsx";
import { PlanView } from "./components/PlanView.tsx";
import { SharedTrips } from "./components/SharedTrips.tsx";
import { AccountButtonSlot, ProReturnSlot } from "./accountSlots.tsx";
import { DEMO, fetchNearestAirport } from "./api.ts";
import { useStore } from "./store.ts";
import { useInsights } from "./insights.ts";
import { readUrlSearch } from "./urlSearch.ts";
import { Logo } from "./components/Logo.tsx";
import { ThemePicker } from "./components/ThemePicker.tsx";
import { shortDate, travelerCount } from "./format.ts";

const Globe = lazy(() => import("./components/Globe.tsx").then(({ Globe }) => ({ default: Globe })));
const searchViews = ["List", "Calendar", "Map"] as const;

class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <p role="status">The map could not load. Open List or Calendar to explore these fares.</p> : this.props.children;
  }
}

/** Deep-link params are applied once per page load (React may run effects twice in development). */
let urlSearchHandled = false;

export function App() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const selected = useStore((s) => s.selectedFare);
  const quota = useStore((s) => s.quota);
  const refreshQuota = useStore((s) => s.refreshQuota);
  const submitted = useStore((s) => s.submitted);
  const request = useStore((s) => s.submitted ?? s.request);
  const searching = useStore((s) => s.status === "searching");
  const cancel = useStore((s) => s.cancelSearch);
  const [panel, setPanel] = useState<typeof searchViews[number]>("List");
  const [editing, setEditing] = useState(false);
  const [hash, setHash] = useState(window.location.hash);
  const exploring = !submitted && !selected;
  const route = (tokens: string[]) => tokens.map((token) => resolvePlace(token)?.label ?? token).join(", ");

  useEffect(() => {
    void refreshQuota();
  }, [refreshQuota]);
  const initWatches = useInsights((s) => s.initWatches);
  useEffect(() => { void initWatches(); }, [initWatches]);
  // Deep links (e.g. from the guides): ?to=…&depart=YYYY-MM pre-fills the search and runs it once.
  useEffect(() => {
    if (urlSearchHandled) return;
    urlSearchHandled = true;
    const patch = readUrlSearch(window.location.search, todayISO());
    if (!patch) {
      // No search in the link: start from the visitor's nearest airport, unless they already chose one.
      const initial = useStore.getState().request.origins.join();
      void fetchNearestAirport().then((airport) => {
        const s = useStore.getState();
        if (airport && s.request.origins.join() === initial && !s.submitted) s.setRequest({ origins: [airport] });
      });
      return;
    }
    useStore.getState().setRequest(patch);
    void useStore.getState().runSearch();
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
  }, []);
  useEffect(() => { if (selected) { setPanel("List"); setEditing(false); } }, [selected]);
  useEffect(() => { if (submitted) { setPanel("List"); setEditing(false); } }, [submitted]);
  useEffect(() => {
    const update = () => setHash(window.location.hash);
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  if (hash.startsWith("#share=")) return <div className="app"><SharedTrips hash={hash} /><ThemePicker /></div>;

  return (
    <div className="app">
      <header className="top">
        <a className="brand" href={SITE_ROOT} aria-label="Tripica homepage">
          <Logo size={32} />
          Tripica
        </a>
        {DEMO && (
          <a className="gh" href="https://github.com/nkanter04/farescope" target="_blank" rel="noreferrer noopener">
            Source on GitHub ↗
          </a>
        )}
        <a className="guides-link" href={`${SITE_ROOT}guides/`}>When to visit</a>
        <nav className="tabs">
          <button className={view === "search" ? "on" : ""} title={view === "search" ? "Start a new search" : undefined}
            onClick={() => (view === "search" ? useStore.getState().goHome() : setView("search"))}>
            Search
          </button>
          <button className={view === "plan" ? "on" : ""} onClick={() => setView("plan")}>
            Plan a trip
          </button>
          <button className={view === "trips" ? "on" : ""} onClick={() => setView("trips")}>
            My trips
          </button>
        </nav>
        {quota && (
          <div className={`quota ${quota.live ? "live" : "demo"}`}
            title={quota.live ? "Each live price lookup uses one credit; a search uses up to a few. Cached prices are free." : undefined}>
            {!quota.live ? "Demo · simulated prices"
              : quota.clientBudget !== undefined
                ? `Live prices · ${Math.max(0, quota.clientBudget - (quota.clientUsed ?? 0))} credits left ${quota.clientPeriod === "month" ? "this month" : "today"}`
                : `Live prices · ${quota.monthlyBudget - quota.monthlyUsed} searches left this month`}
          </div>
        )}
        <AccountButtonSlot />
      </header>
      <ProReturnSlot />
      <div className="launch-links">{DEMO && <><a href="https://tripica.farescope.workers.dev/app/">Open Tripica for live prices</a> · </>}<a href={`${SITE_ROOT}privacy/`}>Privacy</a> · <a href={`${SITE_ROOT}terms/`}>Terms</a></div>

      {view === "search" ? (
        <main className="layout">
          <aside className={`side ${editing ? "editing" : ""}`}>
            <button className="edit-search" aria-expanded={editing} onClick={() => setEditing(!editing)}>
              {editing ? "Search options" : "Edit search"} <span aria-hidden>{editing ? "−" : "+"}</span>
            </button>
            <div className="form-wrap">
              <SearchForm onSearch={() => { setPanel("List"); setEditing(false); }} />
            </div>
          </aside>
          <section className="stage">
            {exploring ? <ExploreHome /> : <>
            <header className="search-heading">
              <h1>{selected ? `${selected.origin} → ${selected.destination}` : `${route(request.origins) || "Origin"} → ${route(request.destinations) || "Destination"}`}</h1>
              {!selected && <p className="muted">{shortDate(request.departFrom)} – {shortDate(request.departTo)} · {travelerCount(request.adults)}</p>}
            </header>
            <div className="seg view-switch" role="group" aria-label="Explore search results">
              {searchViews.map((name) => <button key={name} className={name === panel ? "on" : ""} aria-pressed={name === panel} onClick={() => setPanel(name)}>{name}</button>)}
            </div>
            {searching && !editing && <button className="link mobile-cancel" onClick={cancel}>Stop search</button>}
            {panel === "List" && (selected ? (selected.priceOnly ? <FareDetailsLoader key={selected.id} fare={selected} /> : <FarePanel key={selected.id} />) : <ResultsList />)}
            {panel === "Calendar" && <PriceCalendar />}
            {panel === "Map" && <MapBoundary><Suspense fallback={<p role="status">Loading the globe…</p>}><Globe /></Suspense></MapBoundary>}
            </>}
          </section>
        </main>
      ) : view === "plan" ? (
        <main className="single">
          <PlanView />
        </main>
      ) : (
        <main className="single">
          <TripsView />
        </main>
      )}
      <ThemePicker />
    </div>
  );
}
