import { describe, expect, it } from "vitest";
import { currentUtcMonthRange, endOfDayIso } from "./dates";

describe("endOfDayIso", () => {
  it("pushes a bare date to the last instant of that day (AC4)", () => {
    expect(endOfDayIso("2026-07-15")).toBe("2026-07-15T23:59:59.999Z");
    // The AC4 example: a transaction timestamped 10:00 on the filtered day
    // must sort at or before the transformed bound.
    expect("2026-07-15T10:00:00Z" <= endOfDayIso("2026-07-15")).toBe(true);
  });
});

describe("currentUtcMonthRange", () => {
  it("returns the first day of the month and today", () => {
    const now = new Date("2026-07-20T15:00:00Z");
    expect(currentUtcMonthRange(now)).toEqual({ from: "2026-07-01", to: "2026-07-20" });
  });
});
