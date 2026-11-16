import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { TripPlan } from "@farescope/shared";

/**
 * Saved trips, keyed by owner. Until Supabase auth lands (Phase 2b), the owner is an anonymous
 * per-browser id, so trips are private-by-obscurity only. Do not store anything sensitive.
 */
export class TripStore {
  constructor(private db: DatabaseSync) {}

  list(owner: string): TripPlan[] {
    const rows = this.db.prepare("SELECT data FROM trips WHERE owner = ? ORDER BY created_at DESC LIMIT 100").all(owner) as {
      data: string;
    }[];
    return rows.map((r) => JSON.parse(r.data) as TripPlan);
  }

  create(owner: string, input: Omit<TripPlan, "id" | "createdAt" | "total">): TripPlan {
    const trip: TripPlan = {
      ...input,
      id: randomUUID(),
      total: input.fare.price + (input.stay?.total ?? 0),
      createdAt: new Date().toISOString(),
    };
    this.db.prepare("INSERT INTO trips (id, owner, data, created_at) VALUES (?, ?, ?, ?)").run(trip.id, owner, JSON.stringify(trip), Date.now());
    return trip;
  }

  remove(owner: string, id: string): boolean {
    const r = this.db.prepare("DELETE FROM trips WHERE owner = ? AND id = ?").run(owner, id);
    return Number(r.changes) > 0;
  }
}
