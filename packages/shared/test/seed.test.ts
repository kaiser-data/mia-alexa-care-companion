import { describe, expect, it } from "vitest";
import { isSeedId, rose, roseDe, SEED_PROFILES } from "../src/seed/rose";

describe("seed profiles", () => {
  it("Rose has a location, favourite music, a check-in time and a bedtime", () => {
    const p = rose();
    expect(p.location).toEqual({ latitude: 39.9612, longitude: -82.9988 });
    expect(p.favouriteMusic).toBe("Ella Fitzgerald");
    expect(p.checkInTime).toBe("15:30");
    expect(p.routine.find((r) => r.kind === "bedtime")?.time).toBe("21:30");
    expect(roseDe().routine.find((r) => r.kind === "bedtime")?.time).toBe("21:30");
  });
  it("seed ids", () => {
    expect(Object.keys(SEED_PROFILES)).toEqual(["rose", "rose-de"]);
    expect(isSeedId("rose-de")).toBe(true);
    expect(isSeedId("toString")).toBe(false);
    expect(isSeedId("foo")).toBe(false);
  });
});
