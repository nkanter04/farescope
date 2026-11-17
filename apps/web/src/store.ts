import { create } from "zustand";
import { addDays, todayISO, type Fare, type QuotaStatus, type SearchEvent, type SearchRequest, type Stay, type TripPlan } from "@farescope/shared";
import { deleteTrip, fetchQuota, fetchStays, listTrips, saveTrip, streamSearch } from "./api.ts";

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
  stays: Stay[];
  staysStatus: "idle" | "loading" | "done" | "error";
  showingQuotedStay: boolean;
  staysError?: string;
  stayKind: "all" | "hotel" | "hostel" | "rental";
  selectedStay: Stay | null;
  trips: TripPlan[];
  compare: string[];
  quota?: QuotaStatus;

  setView(v: State["view"]): void;
  setRequest(patch: Partial<SearchRequest>): void;
  runSearch(): Promise<void>;
  cancelSearch(): void;
  setFilterDest(d: string | null): void;
  setFilterDate(d: string | null): void;
  selectFare(f: Fare | null, quotedStay?: Stay): Promise<void>;
  setStayKind(k: State["stayKind"]): void;
  selectStay(s: Stay | null): void;
  saveCurrentTrip(name: string): Promise<void>;
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
  },
  status: "idle",
  progress: { done: 0, total: 0, providerCalls: 0, planned: 0, candidates: 0 },
  notices: [],
  fares: [],
  filterDest: null,
  filterDate: null,
  selectedFare: null,
  stays: [],
  staysStatus: "idle",
  showingQuotedStay: false,
  stayKind: "all",
  selectedStay: null,
  trips: [],
  compare: [],

  setView: (view) => set({ view }),
  setRequest: (patch) => set({ request: { ...get().request, ...patch } }),

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
      selectedStay: null,
      stays: [],
      staysStatus: "idle",
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

  setFilterDest: (filterDest) => set({ filterDest }),
  setFilterDate: (filterDate) => set({ filterDate }),

  async selectFare(fare, quotedStay) {
    set({ selectedFare: fare, selectedStay: quotedStay ?? null, showingQuotedStay: !!quotedStay, stays: quotedStay ? [quotedStay] : [],
      stayKind: quotedStay ? "all" : get().stayKind, staysStatus: quotedStay ? "done" : fare ? "loading" : "idle", staysError: undefined });
    if (!fare || quotedStay) return;
    const submitted = get().submitted;
    if (!submitted) return;
    const r = await fetchStays(fare, submitted.adults).catch(() => ({ stays: [] as Stay[], error: "Could not load stays." }));
    if (get().selectedFare !== fare || get().submitted !== submitted) return;
    set({ stays: r.stays, staysStatus: "error" in r && r.error ? "error" : "done", staysError: "error" in r ? r.error : undefined });
    void get().refreshQuota();
  },

  setStayKind: (stayKind) => set({ stayKind }),
  selectStay: (selectedStay) => set({ selectedStay }),

  async saveCurrentTrip(name) {
    const { selectedFare, selectedStay } = get();
    if (!selectedFare) return;
    const trip = await saveTrip(name, selectedFare, selectedStay ?? undefined, get().submitted?.adults);
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
