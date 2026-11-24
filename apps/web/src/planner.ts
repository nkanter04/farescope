import { create } from "zustand";
import { addDays, PlanRequestSchema, resolvePlace, todayISO, type Cabin, type Fare, type ItineraryOption, type PlanRequest, type TripPlan } from "@farescope/shared";
import { DEMO, planTripApi, saveTrip, type PlanResponse } from "./api.ts";
import { useStore } from "./store.ts";
import { track } from "./analytics.ts";

/**
 * The multi-stop planner's form and last result, kept in their own store so they survive switching
 * tabs. The math lives in shared itinerary.ts; this file only turns the form into a PlanRequest.
 */
export interface StopDraft {
  id: string;
  place: string;
  minNights: number;
  maxNights: number;
  /** How you get to this stop from the previous one. */
  mode: "fly" | "own";
  ownCost: string;
}

export interface PlannerState {
  home: string;
  stops: StopDraft[];
  end: "home" | "last" | "place";
  endPlace: string;
  endMode: "fly" | "own";
  endCost: string;
  startFrom: string;
  startTo: string;
  reorder: boolean;
  cabin: Cabin;
  adults: number;
  status: "idle" | "planning" | "done";
  response?: PlanResponse;
  submitted?: PlanRequest;
  set(patch: Partial<PlannerState>): void;
  setStop(id: string, patch: Partial<StopDraft>): void;
  addStop(): void;
  removeStop(id: string): void;
  run(): Promise<void>;
}

const newStop = (place = "", min = 3, max = 5): StopDraft => ({ id: Math.random().toString(36).slice(2, 10), place, minNights: min, maxNights: max, mode: "fly", ownCost: "" });
const today = todayISO();

/** The form as a PlanRequest: "my own way" legs become ground pairs between their two places. */
export function toRequest(s: Pick<PlannerState, "home" | "stops" | "end" | "endPlace" | "endMode" | "endCost" | "startFrom" | "startTo" | "reorder" | "cabin" | "adults">) {
  const ground: { a: number; b: number; cost: number }[] = [];
  s.stops.forEach((stop, i) => {
    if (stop.mode === "own") ground.push({ a: i, b: i + 1, cost: Math.max(0, Number(stop.ownCost) || 0) });
  });
  const n = s.stops.length;
  if (s.end !== "last" && s.endMode === "own") ground.push({ a: n, b: s.end === "home" ? 0 : n + 1, cost: Math.max(0, Number(s.endCost) || 0) });
  return PlanRequestSchema.safeParse({
    home: s.home.trim(),
    stops: s.stops.map((x) => ({ place: x.place.trim(), minNights: x.minNights, maxNights: x.maxNights })),
    end: s.end,
    endPlace: s.end === "place" ? s.endPlace.trim() : undefined,
    ground,
    startFrom: s.startFrom,
    startTo: s.startTo,
    reorder: s.reorder && n >= 2,
    cabin: s.cabin,
    adults: s.adults,
  });
}

export const usePlanner = create<PlannerState>((set, get) => ({
  home: "",
  stops: [newStop()],
  end: "home",
  endPlace: "",
  endMode: "fly",
  endCost: "",
  startFrom: addDays(today, 60),
  startTo: addDays(today, 74),
  reorder: false,
  cabin: "economy",
  adults: 1,
  status: "idle",
  set: (patch) => set(patch),
  setStop: (id, patch) => set({ stops: get().stops.map((s) => (s.id === id ? { ...s, ...patch } : s)) }),
  addStop: () => set({ stops: [...get().stops, newStop()] }),
  removeStop: (id) => set({ stops: get().stops.filter((s) => s.id !== id) }),
  async run() {
    const parsed = toRequest(get());
    if (!parsed.success) return;
    set({ status: "planning", submitted: parsed.data, response: undefined });
    track("plan_run", `${parsed.data.stops.length} stops${parsed.data.reorder ? ", reorder" : ""}`);
    const response = await planTripApi(parsed.data).catch((e: Error) => ({ airports: {}, creditsUsed: 0, notices: [], error: e.message }));
    set({ status: "done", response });
  },
}));

const label = (token: string) => resolvePlace(token)?.label.replace(/ \([A-Z]{3}\)$/, "") ?? token;

/** A planned option as a saved trip: its legs, a stay per stop, and the first leg as `fare`. */
export function optionToTrip(option: ItineraryOption, airports: Record<number, string>, req: PlanRequest, now = new Date()): Omit<TripPlan, "id" | "total" | "createdAt"> {
  const legs = option.legs.map((leg) => ({
    from: label(leg.fromPlace), to: label(leg.toPlace), fromAirport: airports[leg.from], toAirport: airports[leg.to],
    date: leg.date, mode: leg.mode === "fly" ? "fly" as const : "ground" as const, price: leg.price,
  }));
  const first = option.legs.find((leg) => leg.mode === "fly") ?? option.legs[0];
  const fare: Fare = {
    id: `plan-${airports[first.from]}-${airports[first.to]}-${first.date}`, provider: DEMO ? "mock" : "plan", origin: airports[first.from], destination: airports[first.to],
    departDate: first.date, price: first.price, currency: "USD", airlines: [], stops: 0, durationMin: 0, outbound: [],
    fetchedAt: now.toISOString(), cached: true,
  };
  const name = `${option.stays.map((s) => label(s.place)).join(", ")} · ${option.start}`.slice(0, 120);
  return {
    name, adults: req.adults, fare, legs,
    lodging: option.stays.map((s, i) => ({ id: `stop-${i}-${s.checkIn}`, place: label(s.place), checkIn: s.checkIn, checkOut: s.checkOut })),
  };
}

/** Save a planned option to My trips and return it. */
export async function savePlannedTrip(option: ItineraryOption): Promise<TripPlan> {
  const { response, submitted } = usePlanner.getState();
  if (!response || !submitted) throw new Error("Plan a trip first.");
  const trip = await saveTrip(optionToTrip(option, response.airports, submitted));
  track("trip_save", "plan");
  useStore.setState({ trips: [trip, ...useStore.getState().trips] });
  return trip;
}
