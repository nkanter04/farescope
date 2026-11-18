import { z } from "zod";

const text = z.string().max(500);
const date = z.string().date();
const amount = z.number().finite().nonnegative();
const stay = z.object({
  id: text, provider: text, name: text, kind: z.enum(["hotel", "hostel", "rental"]),
  nightly: amount, total: amount, totalBasis: z.enum(["quoted", "nightly-estimate"]).optional(),
  stale: z.boolean().optional(), checkIn: date, checkOut: date, amenities: z.array(text).max(50).default([]),
});

/** Deliberately strips booking URLs, images, saved searches and unrelated fields from public snapshots. */
export const TripShareSchema = z.object({
  version: z.literal(1),
  trips: z.array(z.object({
    id: text, name: z.string().min(1).max(120), adults: z.number().int().min(1).max(9).optional(),
    notes: z.string().max(5000).optional(), total: amount, createdAt: text,
    fare: z.object({
      id: text, provider: text, origin: z.string().regex(/^[A-Z]{3}$/), destination: z.string().regex(/^[A-Z]{3}$/),
      departDate: date, returnDate: date.optional(), price: amount, currency: z.literal("USD"),
      airlines: z.array(text).max(10), stops: z.number().int().min(0).max(10), durationMin: amount,
      outbound: z.array(z.object({ from: text, to: text, depart: text, arrive: text,
        airline: text, flightNumber: text, durationMin: amount })).max(10),
      fetchedAt: text, cached: z.boolean(), stale: z.boolean().optional(),
    }),
    stay: stay.optional(),
    lodging: z.array(z.object({ id: text, place: z.string().min(1).max(160), checkIn: date, checkOut: date,
      stay: stay.optional(), ownCost: amount.optional(),
    }).refine(stop => stop.checkOut > stop.checkIn && (!stop.stay ||
      (stop.stay.checkIn === stop.checkIn && stop.stay.checkOut === stop.checkOut)))).max(30).optional(),
  })).min(1).max(3),
});
