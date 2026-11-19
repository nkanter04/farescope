import { z } from "zod";
import type { PricePoint } from "./forecast.ts";

export const CABINS = ["economy", "premium", "business", "first"] as const;
export type Cabin = (typeof CABINS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

/** A flexible search: sets of places x a window of dates x a range of trip lengths. */
export const SearchRequestSchema = z
  .object({
    /** Place tokens: IATA code, city, country, region, or "anywhere". */
    origins: z.array(z.string().min(1)).min(1).max(10),
    destinations: z.array(z.string().min(1)).min(1).max(10),
    /** Earliest and latest departure date (inclusive). */
    departFrom: isoDate,
    departTo: isoDate,
    tripType: z.enum(["roundtrip", "oneway"]),
    minNights: z.number().int().min(1).max(60).default(5),
    maxNights: z.number().int().min(1).max(60).default(10),
    cabin: z.enum(CABINS).default("economy"),
    /** null = any number of stops. */
    maxStops: z.union([z.literal(0), z.literal(1), z.literal(2), z.null()]).default(null),
    adults: z.number().int().min(1).max(9).default(1),
    /** Only show itineraries flown entirely by these airlines (IATA codes). Empty = any airline. */
    airlines: z.array(z.string().regex(/^[A-Z0-9]{2}$/)).max(40).default([]),
    /** Prices only: skip itinerary lookups and lodging (the explore page). */
    quick: z.boolean().optional(),
  })
  .refine((r) => r.departFrom <= r.departTo, { message: "departFrom must be on or before departTo" })
  .refine((r) => r.minNights <= r.maxNights, { message: "minNights must be <= maxNights" });

export type SearchRequest = z.infer<typeof SearchRequestSchema>;

export interface FlightLeg {
  from: string;
  to: string;
  /** Local times as "YYYY-MM-DD HH:mm" (as reported by the provider). */
  depart: string;
  arrive: string;
  airline: string;
  flightNumber: string;
  durationMin: number;
  /** IATA code of the operating airline, when known. */
  airlineCode?: string;
  /** Logo URL supplied by the provider (live data). */
  airlineLogo?: string;
}

export interface Fare {
  id: string;
  provider: string;
  origin: string;
  destination: string;
  departDate: string;
  returnDate?: string;
  /** Total price for all passengers, round trip if returnDate is set. USD. */
  price: number;
  currency: "USD";
  airlines: string[];
  stops: number;
  durationMin: number;
  outbound: FlightLeg[];
  bookingUrl?: string;
  fetchedAt: string;
  /** True when served from cache rather than a fresh provider call. */
  cached: boolean;
  /** True when served from an expired cache entry because the budget ran out. */
  stale?: boolean;
  /** Cache key of the provider query that produced this fare (for its price history). */
  queryKey?: string;
  /**
   * True for a date-grid price (e.g. Google Flights' calendar): the cheapest total for these dates,
   * without airlines, stops or times. Opening it fetches the real itineraries.
   */
  priceOnly?: boolean;
  /**
   * What a calendar price covers when it isn't one airport pair: airport codes or Google place IDs
   * ("/m/03_3d" = Japan), with display labels. Opening the fare searches exactly these.
   */
  coverage?: { origins: string[]; destinations: string[]; originLabel?: string; destinationLabel?: string };
}

const iata = z.string().regex(/^[A-Z]{3}$/);
/** An airport code or a Google place ID ("/m/03_3d"). */
const placeId = z.string().regex(/^(?:[A-Z]{3}|\/[mg]\/[0-9a-z_]{2,20})$/);
/** Validates a Fare sent back to the API (price trend, watches). */
export const FareSchema = z.object({
  id: z.string().max(200),
  provider: z.string().max(40),
  origin: iata,
  destination: iata,
  departDate: z.string().date(),
  returnDate: z.string().date().optional(),
  price: z.number().positive().finite(),
  currency: z.literal("USD"),
  airlines: z.array(z.string().max(80)).max(10),
  stops: z.number().int().min(0).max(10),
  durationMin: z.number().nonnegative().finite(),
  outbound: z.array(z.object({
    from: z.string().max(8), to: z.string().max(8), depart: z.string().max(40), arrive: z.string().max(40),
    airline: z.string().max(80), flightNumber: z.string().max(20), durationMin: z.number().nonnegative().finite(),
    airlineCode: z.string().max(3).optional(), airlineLogo: z.string().max(500).optional(),
  })).max(10),
  bookingUrl: z.string().max(2000).optional(),
  fetchedAt: z.string().max(40),
  cached: z.boolean(),
  stale: z.boolean().optional(),
  queryKey: z.string().max(500).optional(),
  priceOnly: z.boolean().optional(),
  coverage: z.object({
    origins: z.array(placeId).min(1).max(10),
    destinations: z.array(placeId).min(1).max(10),
    originLabel: z.string().max(80).optional(),
    destinationLabel: z.string().max(80).optional(),
  }).optional(),
});

export interface PriceInsights {
  lowestPrice?: number;
  priceLevel?: "low" | "typical" | "high";
  typicalRange?: [number, number];
  /** Daily lowest price for this search over recent weeks (Google Flights' price_history). */
  history?: PricePoint[];
}

export type StayKind = "hotel" | "hostel" | "rental";

export interface Stay {
  id: string;
  provider: string;
  name: string;
  kind: StayKind;
  lat?: number;
  lng?: number;
  nightly: number;
  total: number;
  totalBasis?: "quoted" | "nightly-estimate";
  stale?: boolean;
  rating?: number;
  reviews?: number;
  stars?: number;
  checkIn: string;
  checkOut: string;
  url?: string;
  image?: string;
  amenities: string[];
}

export interface TripPlan {
  id: string;
  name: string;
  /** Older saves predate the traveler-count snapshot. */
  adults?: number;
  fare: Fare;
  stay?: Stay;
  lodging?: LodgingStop[];
  notes?: string;
  search?: SearchRequest;
  total: number;
  createdAt: string;
}

export interface LodgingStop {
  id: string;
  place: string;
  checkIn: string;
  checkOut: string;
  stay?: Stay;
  /** A user-entered cost for accommodation arranged separately, including zero. */
  ownCost?: number;
}

/** A flight the user is watching for price changes. */
export interface PriceWatch {
  id: string;
  fare: Fare;
  cabin: Cabin;
  adults: number;
  priceAtWatch: number;
  lastPrice: number;
  /** ISO timestamp of the last successful re-check. */
  lastChecked: string;
  /** Prices seen at each check (oldest first, capped). */
  checks: PricePoint[];
  createdAt: string;
  /** Set when the flight has departed or can no longer be found. */
  status?: "active" | "departed" | "unavailable";
}

export interface QuotaStatus {
  provider: string;
  live: boolean;
  monthlyBudget: number;
  monthlyUsed: number;
  dailyClientBudget: number;
  dailyClientUsed: number;
}

/** Server-sent events streamed by POST /api/search. */
export type SearchEvent =
  | { type: "start"; totalCandidates: number; plannedCalls: number; live: boolean }
  | { type: "fare"; fare: Fare }
  | { type: "insights"; route: string; insights: PriceInsights }
  | { type: "progress"; done: number; total: number; providerCalls: number }
  | { type: "notice"; level: "info" | "warn"; message: string }
  | { type: "done"; fares: number; providerCalls: number; cacheHits: number }
  | { type: "error"; message: string };
