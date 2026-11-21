import { create } from "zustand";
import { addDays, todayISO, tripStops, AIRPORT_BY_IATA, type Fare, type QuotaStatus, type SearchEvent, type SearchRequest, type TripPlan } from "@farescope/shared";
import { deleteTrip, fetchFareDetails, fetchQuota, listTrips, saveTrip, streamSearch } from "./api.ts";

/** Shared empty airline filter (stable identity for React selectors). */
export const ANY_AIRLINE: string[] = [];

/** True when `full` (a real itinerary) covers the same trip as the date-grid price `priceOnly`. */
export function supersedes(full: Fare, priceOnly: Fare): boolean {
  if (full.priceOnly || !priceOnly.priceOnly) return false;
  if (full.departDate !== priceOnly.departDate || (full.returnDate ?? "") !== (priceOnly.returnDate ?? "")) return false;
  // Same provider query (the grid price's exact-date lookup) is the reliable match, even for whole countries.
  if (full.queryKey && priceOnly.queryKey) return full.queryKey === priceOnly.queryKey;
  const origins = priceOnly.coverage?.origins ?? [priceOnly.origin];
  const destinations = priceOnly.coverage?.destinations ?? [priceOnly.destination];
  return origins.includes(full.origin) && destinations.includes(full.destination);
}

/** Add fares, dropping date-grid prices that now have real itineraries. */
export function mergeFares(current: Fare[], incoming: Fare[]): Fare[] {
  const full = incoming.filter((f) => !f.priceOnly);
  const kept = full.length ? current.filter((f) => !f.priceOnly || !full.some((x) => supersedes(x, f))) : current;
  const ids = new Set(kept.map((f) => f.id));
  return [...kept, ...incoming.filter((f) => !ids.has(f.id) && !(f.priceOnly && kept.some((x) => supersedes(x, f))))];
}

export type TripDraft = Omit<TripPlan, "id" | "total" | "createdAt"> & { id?: string };

export interface Notice {
  level: "info" | "warn" | "error";
  message: string;
}

interface State {
  view: "search" | "plan" | "trips";
  request: SearchRequest;
  submitted?: SearchRequest;
  status: "idle" | "searching" | "done" | "error";
  progress: { done: number; total: number; providerCalls: number; planned: number; candidates: number };
  notices: Notice[];
  fares: Fare[];
  filterDest: string | null;
  filterDate: string | null;
  selectedFare: Fare | null;
  /** Loading real itineraries for a selected date-grid price. */
  details?: { fareId: string; status: "loading" | "error"; message?: string };
  draft?: TripDraft;
  sort: "price" | "duration" | "stops";
  trips: TripPlan[];
  compare: string[];
  quota?: QuotaStatus;

  setView(v: State["view"]): void;
  setRequest(patch: Partial<SearchRequest>): void;
  runSearch(): Promise<void>;
  cancelSearch(): void;
  /** Back to the explore home page (keeps the form's values). */
  goHome(): void;
  setFilterDest(d: string | null): void;
  setFilterDate(d: string | null): void;
  selectFare(f: Fare | null): Promise<void>;
  setSort(sort: State["sort"]): void;
  setDraft(patch: Partial<TripDraft>): void;
  openTrip(trip: TripPlan): void;
  saveCurrentTrip(): Promise<boolean>;
  saveResult(fare: Fare): Promise<void>;
  loadTrips(): Promise<void>;
  removeTrip(id: string): Promise<void>;
  toggleCompare(id: string): void;
  refreshQuota(): Promise<void>;
}

const today = todayISO();
let controller: AbortController | null = null;

export const useStore = create<State>((set, get) => ({
  view: "search",
  request: {
    origins: [],
    destinations: [],
    departFrom: addDays(today, 60),
    departTo: addDays(today, 150),
    tripType: "roundtrip",
    minNights: 7,
    maxNights: 12,
    cabin: "economy",
    maxStops: null,
    adults: 1,
    airlines: [],
  },
  status: "idle",
  progress: { done: 0, total: 0, providerCalls: 0, planned: 0, candidates: 0 },
  notices: [],
  fares: [],
  filterDest: null,
  filterDate: null,
  selectedFare: null,
  sort: "price",
  trips: [],
  compare: [],

  setView: (view) => set({ view }),
  // Older saved searches predate the airline filter, so always keep it an array.
  setRequest: (patch) => {
    const request = { ...get().request, ...patch };
    set({ request: { ...request, airlines: request.airlines ?? [] } });
  },

  async runSearch() {
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const submitted = get().request;
    set({
      submitted,
      status: "searching",
      fares: [],
      notices: [],
      filterDest: null,
      filterDate: null,
      selectedFare: null,
      details: undefined,
      draft: undefined,
      progress: { done: 0, total: 0, providerCalls: 0, planned: 0, candidates: 0 },
    });
    // Batch incoming fares into one state update per animation frame.
    let pending: Fare[] = [];
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (controller?.signal === signal && pending.length) {
        set({ fares: mergeFares(get().fares, pending) });
        pending = [];
      }
    };
    const onEvent = (e: SearchEvent) => {
      if (signal.aborted) return;
      switch (e.type) {
        case "start":
          set({ progress: { ...get().progress, planned: e.plannedCalls, candidates: e.totalCandidates } });
          break;
        case "fare":
          pending.push(e.fare);
          if (!raf) raf = requestAnimationFrame(flush);
          break;
        case "progress":
          set({ progress: { ...get().progress, done: e.done, total: e.total, providerCalls: e.providerCalls } });
          break;
        case "notice":
          set({ notices: [...get().notices, { level: e.level, message: e.message }] });
          break;
        case "error":
          set({ status: "error", notices: [...get().notices, { level: "error", message: e.message }] });
          break;
        case "done":
          break;
      }
    };
    try {
      await streamSearch(submitted, onEvent, signal);
      flush();
      if (!signal.aborted && get().status === "searching") set({ status: "done" });
    } catch (err) {
      flush();
      if (!signal.aborted && (err as Error).name !== "AbortError") {
        set({ status: "error", notices: [...get().notices, { level: "error", message: "Could not reach the search server." }] });
      }
    }
    void get().refreshQuota();
  },

  cancelSearch() {
    controller?.abort();
    set({ status: "done" });
  },
  goHome() {
    controller?.abort();
    set({ view: "search", submitted: undefined, status: "idle", fares: [], notices: [], selectedFare: null, details: undefined, draft: undefined, filterDest: null, filterDate: null });
  },

  setFilterDest: (filterDest) => set({ filterDest }),
  setFilterDate: (filterDate) => set({ filterDate }),

  async selectFare(fare) {
    if (fare?.priceOnly) {
      // A date-grid price has no itinerary yet: fetch the real flights for these dates, then open the cheapest.
      set({ selectedFare: fare, draft: undefined, details: { fareId: fare.id, status: "loading" } });
      const search = get().submitted ?? get().request;
      const result = await fetchFareDetails(fare, { cabin: search.cabin, maxStops: search.maxStops, adults: search.adults, airlines: search.airlines })
        .catch((e: Error) => ({ fares: [] as Fare[], error: e.message }));
      if (get().selectedFare?.id !== fare.id) return;
      const cheapest = result.fares[0];
      if (!cheapest) {
        set({ details: { fareId: fare.id, status: "error", message: result.error ?? "Google Flights has no flights at this price for these dates anymore. Prices change often." } });
        return;
      }
      set({ fares: mergeFares(get().fares, result.fares), details: undefined });
      return get().selectFare(cheapest);
    }
    set({ selectedFare: fare, details: undefined });
    if (!fare || get().draft?.fare.id === fare.id) return;
    const search = get().submitted;
    const place = AIRPORT_BY_IATA[fare.destination]?.city ?? fare.destination;
    set({ draft: { name: `${place} · ${fare.departDate}`, fare, adults: search?.adults, search, notes: "",
      lodging: [] } });
  },

  setSort: sort => set({ sort }),
  setDraft: patch => { const draft = get().draft; if (draft) set({ draft: { ...draft, ...patch } }); },
  openTrip: trip => set({ view: "search", selectedFare: trip.fare, draft: { ...trip, lodging: tripStops(trip) } }),

  async saveCurrentTrip() {
    const draft = get().draft;
    if (!draft) return false;
    const trip = await saveTrip(draft, draft.id);
    set({ trips: [trip, ...get().trips.filter(item => item.id !== trip.id)] });
    const current = get().draft;
    if (current?.fare === draft.fare && current.id === draft.id) set({ draft: { ...current, id: trip.id } });
    return current === draft;
  },

  async saveResult(fare) {
    const search = get().submitted;
    const trip = await saveTrip({ name: `${AIRPORT_BY_IATA[fare.destination]?.city ?? fare.destination} · ${fare.departDate}`,
      fare, adults: search?.adults, search });
    set({ trips: [trip, ...get().trips] });
  },

  async loadTrips() {
    set({ trips: await listTrips().catch(() => []) });
  },

  async removeTrip(id) {
    await deleteTrip(id);
    set({ trips: get().trips.filter((t) => t.id !== id), compare: get().compare.filter((c) => c !== id) });
  },

  toggleCompare(id) {
    const c = get().compare;
    if (c.includes(id)) set({ compare: c.filter((x) => x !== id) });
    else set({ compare: [...c, id].slice(-3) });
  },

  async refreshQuota() {
    const quota = await fetchQuota();
    if (quota) set({ quota });
  },
}));
