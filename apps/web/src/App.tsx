import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { resolvePlace } from "@farescope/shared";
import { FarePanel } from "./components/FarePanel.tsx";
import { PriceCalendar } from "./components/PriceCalendar.tsx";
import { ResultsList } from "./components/ResultsList.tsx";
import { SearchForm } from "./components/SearchForm.tsx";
import { TripsView } from "./components/TripsView.tsx";
import { DEMO } from "./api.ts";
import { useStore } from "./store.ts";
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
  const [editing, setEditing] = useState(true);
  const route = (tokens: string[]) => tokens.map((token) => resolvePlace(token)?.label ?? token).join(", ");

  useEffect(() => {
    void refreshQuota();
  }, [refreshQuota]);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◍
          </span>
          Farescope
        </div>
        {DEMO && (
          <a className="gh" href="https://github.com/nkanter04/farescope" target="_blank" rel="noreferrer noopener">
            Source on GitHub ↗
          </a>
        )}
        <nav className="tabs">
          <button className={view === "search" ? "on" : ""} onClick={() => setView("search")}>
            Search
          </button>
          <button className={view === "trips" ? "on" : ""} onClick={() => setView("trips")}>
            My trips
          </button>
        </nav>
        {quota && (
          <div className={`quota ${quota.live ? "live" : "demo"}`} title="Live price searches this month">
            {quota.live
              ? `Live prices · ${quota.monthlyBudget - quota.monthlyUsed} searches left this month`
              : "Demo · simulated prices"}
          </div>
        )}
      </header>

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
            <header className="search-heading">
              <h1>{route(request.origins) || "Origin"} → {route(request.destinations) || "Destination"}</h1>
              <p className="muted">{shortDate(request.departFrom)} – {shortDate(request.departTo)} · {travelerCount(request.adults)}</p>
            </header>
            <div className="seg view-switch" role="group" aria-label="Explore search results">
              {searchViews.map((name) => <button key={name} className={name === panel ? "on" : ""} aria-pressed={name === panel} onClick={() => setPanel(name)}>{name}</button>)}
            </div>
            {searching && !editing && <button className="link mobile-cancel" onClick={cancel}>Stop search</button>}
            {panel === "List" && (selected ? <FarePanel key={selected.id} /> : <>
              <h2>Flight results</h2>
              {!submitted && <p className="muted">Search your date range to compare airfares, then select a flight to price a stay.</p>}
              <ResultsList />
            </>)}
            {panel === "Calendar" && <PriceCalendar />}
            {panel === "Map" && <MapBoundary><Suspense fallback={<p role="status">Loading the globe…</p>}><Globe /></Suspense></MapBoundary>}
          </section>
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
