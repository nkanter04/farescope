import type { Cabin, Fare, ReturnOption } from "@farescope/shared";
import { ttlFor } from "../ttl.ts";
import type { FlightProvider } from "../providers/types.ts";
import type { SearchCache, SearchQuota } from "./run.ts";
import { limitError } from "./limits.ts";

/**
 * Return flights for a chosen round-trip fare: cache first, then one live lookup (1 quota unit).
 * Browser-safe (the demo uses it too).
 */
export interface ReturnsInput {
  fare: Fare;
  cabin: Cabin;
  maxStops: 0 | 1 | 2 | null;
  adults: number;
}

export async function returnFlights(
  input: ReturnsInput,
  deps: { provider: FlightProvider; cache: SearchCache; quota: SearchQuota; clientId: string; now?: () => Date; signInHint?: boolean },
): Promise<{ options: ReturnOption[]; cached: boolean; error?: string }> {
  const { fare } = input;
  if (!deps.provider.returns || !fare.returnDate || !fare.returnToken) return { options: [], cached: false, error: "Return flights aren't available for this fare." };
  const key = ["r", deps.provider.name, fare.origin, fare.destination, fare.departDate, fare.returnDate, input.cabin, input.maxStops ?? "any", input.adults, fare.returnToken].join("|");
  const hit = deps.cache.get<ReturnOption[]>(key);
  if (hit && !hit.expired) return { options: hit.value, cached: true };
  if (deps.provider.live) {
    const decision = deps.quota.tryConsume(deps.clientId);
    if (!decision.ok) return hit ? { options: hit.value, cached: true } : { options: [], cached: false, error: limitError(decision.reason, { signInHint: deps.signInHint }) };
  }
  try {
    const options = await deps.provider.returns(fare, input);
    deps.cache.put(key, deps.provider.name, options, ttlFor(fare.departDate, deps.now?.() ?? new Date()));
    return { options, cached: false };
  } catch (e) {
    return hit ? { options: hit.value, cached: true } : { options: [], cached: false, error: (e as Error).message };
  }
}
