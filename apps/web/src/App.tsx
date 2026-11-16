import { useEffect } from "react";
import { FarePanel } from "./components/FarePanel.tsx";
import { Globe } from "./components/Globe.tsx";
import { PriceCalendar } from "./components/PriceCalendar.tsx";
import { ResultsList } from "./components/ResultsList.tsx";
import { SearchForm } from "./components/SearchForm.tsx";
import { TripsView } from "./components/TripsView.tsx";
import { useStore } from "./store.ts";

export function App() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const selected = useStore((s) => s.selectedFare);
  const quota = useStore((s) => s.quota);
  const refreshQuota = useStore((s) => s.refreshQuota);

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
            {quota.live ? `Live prices · ${quota.monthlyBudget - quota.monthlyUsed} searches left this month` : "Demo prices (mock data)"}
          </div>
        )}
      </header>

      {view === "search" ? (
        <main className="layout">
          <aside className="side">
            <SearchForm />
            {selected ? <FarePanel /> : <ResultsList />}
          </aside>
          <section className="stage">
            <Globe />
            <PriceCalendar />
          </section>
        </main>
      ) : (
        <main className="single">
          <TripsView />
        </main>
      )}
    </div>
  );
}
