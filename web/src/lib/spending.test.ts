import { describe, expect, it } from "vitest";
import { average, dailyTotals, utcDayKey } from "./spending";

describe("utcDayKey", () => {
  it("extracts the UTC calendar day from an ISO timestamp", () => {
    expect(utcDayKey("2026-07-15T10:00:00Z")).toBe("2026-07-15");
  });

  it("returns null for an unparseable timestamp", () => {
    expect(utcDayKey("not-a-date")).toBeNull();
  });
});

describe("dailyTotals", () => {
  it("sums amounts per day across the whole range, including zero-total days", () => {
    const totals = dailyTotals(
      [
        { ts: "2026-07-01T10:00:00Z", amount: 10 },
        { ts: "2026-07-01T12:00:00Z", amount: 5 },
        { ts: "2026-07-03T09:00:00Z", amount: 20 },
      ],
      "2026-07-01",
      "2026-07-03"
    );

    expect(totals).toEqual([
      { day: "2026-07-01", total: 15 },
      { day: "2026-07-02", total: 0 },
      { day: "2026-07-03", total: 20 },
    ]);
  });

  it("ignores transactions with an unparseable ts", () => {
    const totals = dailyTotals([{ ts: "garbage", amount: 999 }], "2026-07-01", "2026-07-01");
    expect(totals).toEqual([{ day: "2026-07-01", total: 0 }]);
  });
});

describe("average", () => {
  it("computes the arithmetic mean", () => {
    expect(average([10, 20, 30])).toBe(20);
  });

  it("returns 0 for an empty list instead of dividing by zero", () => {
    expect(average([])).toBe(0);
  });
});
