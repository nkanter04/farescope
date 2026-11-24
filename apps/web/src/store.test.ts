import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Fare, TripPlan } from "@farescope/shared";
import { saveTrip } from "./api.ts";
import { useStore } from "./store.ts";

vi.mock("./api.ts", () => ({ saveTrip: vi.fn(), deleteTrip: vi.fn(), fetchQuota: vi.fn(), listTrips: vi.fn(), streamSearch: vi.fn() }));
vi.mock("./analytics.ts", () => ({ track: vi.fn(), trackView: vi.fn() }));
const fare: Fare = { id: "flight", provider: "mock", origin: "AUS", destination: "HND", departDate: "2027-04-01", returnDate: "2027-04-08",
  price: 900, currency: "USD", airlines: [], outbound: [], durationMin: 1000, stops: 1, fetchedAt: "2026-11-17", cached: false };
beforeEach(() => { vi.resetAllMocks(); useStore.setState({ draft: { name: "Japan", fare, adults: 1, lodging: [] }, trips: [] }); });

describe("saving while editing", () => {
  it("keeps newer edits and attaches the saved ID so the next save updates instead of duplicating", async () => {
    let complete!: (trip: TripPlan) => void;
    vi.mocked(saveTrip).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = useStore.getState().saveCurrentTrip();
    useStore.getState().setDraft({ notes: "Added while the save was in progress" });
    complete({ id: "saved", name: "Japan", fare, adults: 1, lodging: [], total: 900, createdAt: "2026-11-17" });
    expect(await pending).toBe(false);
    expect(useStore.getState().draft).toMatchObject({ id: "saved", notes: "Added while the save was in progress" });
    vi.mocked(saveTrip).mockResolvedValueOnce({ ...useStore.getState().draft!, id: "saved", total: 900, createdAt: "2026-11-17" });
    expect(await useStore.getState().saveCurrentTrip()).toBe(true);
    expect(vi.mocked(saveTrip).mock.calls[1][1]).toBe("saved");
    expect(useStore.getState().trips).toHaveLength(1);
  });
  it("does not replace another trip opened while the previous save was pending", async () => {
    let complete!: (trip: TripPlan) => void;
    vi.mocked(saveTrip).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const pending = useStore.getState().saveCurrentTrip();
    useStore.getState().openTrip({ id: "different", name: "Another trip", fare: { ...fare, id: "other-flight" }, total: 900, createdAt: "2026-11-17" });
    complete({ id: "saved", name: "Japan", fare, total: 900, createdAt: "2026-11-17" });
    await pending;
    expect(useStore.getState().draft?.id).toBe("different");
  });
});
