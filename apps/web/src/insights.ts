import { create } from "zustand";
import type { Cabin, Fare, PriceTrend, PriceWatch } from "@farescope/shared";
import { addWatch, checkWatches, fetchPriceTrend, listWatches, removeWatch } from "./api.ts";

/** Price predictions and price watches, kept apart from the search/trip store. */
interface InsightsState {
  trends: Record<string, PriceTrend | "loading" | "error">;
  watches: PriceWatch[];
  watchError?: string;
  loadTrend(fare: Fare, peers: Fare[]): Promise<void>;
  initWatches(): Promise<void>;
  checkNow(): Promise<void>;
  toggleWatch(fare: Fare, cabin: Cabin, adults: number): Promise<void>;
  unwatch(id: string): Promise<void>;
}

/** Same flight (route + dates + itinerary) regardless of when its price was fetched. */
export const watchKey = (f: Fare) =>
  [f.origin, f.destination, f.departDate, f.returnDate ?? "", f.airlines.join(), f.outbound.map((l) => l.from + l.to).join()].join("|");

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Browser notification when a watched price falls, if the user allowed notifications. */
function notifyDrops(before: PriceWatch[], after: PriceWatch[]) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const prev = new Map(before.map((w) => [w.id, w.lastPrice]));
  for (const w of after) {
    const old = prev.get(w.id);
    if (old !== undefined && w.lastPrice < old) {
      new Notification(`Price dropped to ${money(w.lastPrice)}`, {
        body: `${w.fare.origin} → ${w.fare.destination}, ${w.fare.departDate}: down ${money(old - w.lastPrice)} since the last check.`,
        tag: `farescope-${w.id}`,
      });
    }
  }
}

let timer: ReturnType<typeof setInterval> | undefined;

export const useInsights = create<InsightsState>((set, get) => ({
  trends: {},
  watches: [],

  async loadTrend(fare, peers) {
    const key = fare.id;
    if (get().trends[key] && get().trends[key] !== "error") return;
    set({ trends: { ...get().trends, [key]: "loading" } });
    try {
      const trend = await fetchPriceTrend(fare, peers);
      set({ trends: { ...get().trends, [key]: trend } });
    } catch {
      set({ trends: { ...get().trends, [key]: "error" } });
    }
  },

  async initWatches() {
    set({ watches: await listWatches().catch(() => []) });
    await get().checkNow();
    // Re-check while the app stays open; the server/demo skips watches checked in the last 6 hours.
    timer ??= setInterval(() => void get().checkNow(), 30 * 60_000);
  },

  async checkNow() {
    if (!get().watches.length) return;
    const before = get().watches;
    const after = await checkWatches().catch(() => before);
    notifyDrops(before, after);
    set({ watches: after });
  },

  async toggleWatch(fare, cabin, adults) {
    set({ watchError: undefined });
    const existing = get().watches.find((w) => watchKey(w.fare) === watchKey(fare));
    if (existing) return get().unwatch(existing.id);
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "default") {
        void Notification.requestPermission().catch(() => undefined);
      }
      const watch = await addWatch(fare, cabin, adults);
      set({ watches: [watch, ...get().watches] });
    } catch (e) {
      set({ watchError: (e as Error).message });
    }
  },

  async unwatch(id) {
    await removeWatch(id).catch(() => undefined);
    set({ watches: get().watches.filter((w) => w.id !== id) });
  },
}));
