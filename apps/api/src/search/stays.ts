import type { Stay } from "@farescope/shared";
import { stayQueryKey, type StayProvider, type StayQuery } from "../providers/types.ts";
import { ttlFor } from "../ttl.ts";
import type { SearchCache, SearchQuota } from "./run.ts";

/** Shared by automatic shortlisting and the individual lodging endpoint. */
export async function lookupStays(query: StayQuery, provider: StayProvider, cache: SearchCache,
  quota: SearchQuota, clientId: string, availableUnits: number, now: Date) {
  const key = stayQueryKey(provider.name, query);
  const hit = cache.get<Stay[]>(key);
  if (hit && !hit.expired) return { stays: hit.value, cached: true, units: 0 };
  const units = provider.live ? provider.callsPerSearch : 0;
  const stale = (stays: Stay[]) => stays.map(stay => ({ ...stay, stale: true }));
  if (units > availableUnits || (units > 0 && !quota.tryConsume(clientId, units).ok)) {
    if (hit) return { stays: stale(hit.value), cached: true, stale: true, units: 0 };
    return { stays: [], status: 429, error: "Live lodging budget used up.", units: 0 };
  }
  try {
    const stays = await provider.search(query);
    cache.put(key, provider.name, stays, ttlFor(query.checkIn, now));
    return { stays, cached: false, units };
  } catch {
    if (hit) return { stays: stale(hit.value), cached: true, stale: true, units };
    return { stays: [], status: 502, error: "Lodging provider failed.", units };
  }
}
