import { describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { inject } from "./test-inject.ts";
import { loadConfig } from "./config.ts";

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

describe("config", () => {
  it("requires a token for Travelpayouts and accepts the marker", () => {
    expect(() => loadConfig(env({ PROVIDER: "travelpayouts" }))).toThrow(/TRAVELPAYOUTS_TOKEN/);
    expect(loadConfig(env({ PROVIDER: "travelpayouts", TRAVELPAYOUTS_TOKEN: "t", TRAVELPAYOUTS_MARKER: "m" }))).toMatchObject({
      provider: "travelpayouts", travelpayoutsToken: "t", travelpayoutsMarker: "m",
    });
    expect(() => loadConfig(env({ PROVIDER: "kayak" }))).toThrow(/PROVIDER must be/);
  });

  it("never pairs real flights with simulated hotel prices", async () => {
    const app = buildApp(loadConfig(env({ PROVIDER: "travelpayouts", TRAVELPAYOUTS_TOKEN: "t" })), { dbPath: ":memory:" });
    try {
      const health = (await inject(app, "/api/health")).json();
      expect(health).toMatchObject({ provider: "travelpayouts", live: true });
      const stays = (await inject(app, "/api/stays?airport=HND&checkIn=2027-04-02&checkOut=2027-04-09")).json();
      expect(stays.stays).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
