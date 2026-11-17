import { z } from "zod";

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
}

export interface PriceInsights {
  lowestPrice?: number;
  priceLevel?: "low" | "typical" | "high";
  typicalRange?: [number, number];
}

export type StayKind = "hotel" | "hostel" | "rental";

export interface Stay {
  id: string;
  provider: string;
  name: string;
  kind: StayKind;
  lat: number;
  lng: number;
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
  total: number;
  createdAt: string;
}

export interface QuotaStatus {
  provider: string;
  live: boolean;
  monthlyBudget: number;
  monthlyUsed: number;
  dailyClientBudget: number;
  dailyClientUsed: number;
}

export interface TripQuote {
  fare: Fare;
  stay: Stay;
}

/** Server-sent events streamed by POST /api/search. */
export type SearchEvent =
  | { type: "start"; totalCandidates: number; plannedCalls: number; live: boolean }
  | { type: "fare"; fare: Fare }
  | { type: "shortlist"; checked: number; planned: number; eligible: number; quotes: TripQuote[] }
  | { type: "insights"; route: string; insights: PriceInsights }
  | { type: "progress"; done: number; total: number; providerCalls: number }
  | { type: "notice"; level: "info" | "warn"; message: string }
  | { type: "done"; fares: number; providerCalls: number; cacheHits: number }
  | { type: "error"; message: string };
