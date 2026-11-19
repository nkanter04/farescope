import { create } from "zustand";
import { addDays, todayISO, tripStops, AIRPORT_BY_IATA, type Fare, type QuotaStatus, type SearchEvent, type SearchRequest, type Stay, type TripPlan } from "@farescope/shared";
import { deleteTrip, fetchQuota, listTrips, saveTrip, streamSearch } from "./api.ts";

/** Shared empty airline filter (stable identity for React selectors). */
export const ANY_AIRLINE: string[] = [];

export type TripDraft = Omit<TripPlan, "id" | "total" | "createdAt"> & { id?: string };

export interface Notice {
  level: "info" | "warn" | "error";
  message: string;
}

interface State {
  view: "search" | "trips";
  request: SearchRequest;
  submitted?: SearchRequest;
  status: "idle" | "searching" | "done" | "error";
  progress: { done: number; total: number; providerCalls: number; planned: number; candidates: number };
  notices: Notice[];
  fares: Fare[];
  shortlist?: Extract<SearchEvent, { type: "shortlist" }>;
  filterDest: string | null;
  filterDate: string | null;
  selectedFare: Fare | null;
  draft?: TripDraft;
  sort: "price" | "airfare" | "duration" | "stops";
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
  selectFare(f: Fare | null, quotedStay?: Stay): Promise<void>;
  setSort(sort: State["sort"]): void;
  setDraft(patch: Partial<TripDraft>): void;
  openTrip(trip: TripPlan): void;
  saveCurrentTrip(): Promise<boolean>;
  saveResult(fare: Fare, stay?: Stay): Promise<void>;
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
    origins: ["AUS"],
    destinations: ["country:JP"],
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
      shortlist: undefined,
      notices: [],
      filterDest: null,
      filterDate: null,
      selectedFare: null,
      draft: undefined,
      progress: { done: 0, total: 0, providerCalls: 0, planned: 0, candidates: 0 },
    });
    // Batch incoming fares into one state update per animation frame.
    let pending: Fare[] = [];
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (controller?.signal === signal && pending.length) {
        set({ fares: [...get().fares, ...pending] });
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
        case "shortlist":
          set({ shortlist: e });
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
    set({ view: "search", submitted: undefined, status: "idle", fares: [], shortlist: undefined, notices: [], selectedFare: null, draft: undefined, filterDest: null, filterDate: null });
  },

  setFilterDest: (filterDest) => set({ filterDest }),
  setFilterDate: (filterDate) => set({ filterDate }),

  async selectFare(fare, quotedStay) {
    set({ selectedFare: fare });
    if (!fare || get().draft?.fare.id === fare.id) return;
    const search = get().submitted;
    const place = AIRPORT_BY_IATA[fare.destination]?.city ?? fare.destination;
    set({ draft: { name: `${place} · ${fare.departDate}`, fare, adults: search?.adults, search, notes: "",
      lodging: quotedStay ? [{ id: crypto.randomUUID(), place, checkIn: quotedStay.checkIn, checkOut: quotedStay.checkOut, stay: quotedStay }] : [] } });
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

  async saveResult(fare, stay) {
    const search = get().submitted;
    const trip = await saveTrip({ name: `${AIRPORT_BY_IATA[fare.destination]?.city ?? fare.destination} · ${fare.departDate}`,
      fare, stay, adults: search?.adults, search });
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
