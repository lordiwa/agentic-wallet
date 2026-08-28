import { describe, expect, it } from "vitest";
import { daysUntil } from "./countdown";

describe("daysUntil", () => {
  it("computes the whole-day gap to a future date (AC2)", () => {
    const now = new Date("2026-07-20T15:00:00Z");
    expect(daysUntil("2026-07-25", now)).toBe(5);
  });

  it("returns 0 for today and a negative number for a past date", () => {
    const now = new Date("2026-07-20T15:00:00Z");
    expect(daysUntil("2026-07-20", now)).toBe(0);
    expect(daysUntil("2026-07-18", now)).toBe(-2);
  });

  it("returns null (never invents a number) for a null/unparseable date", () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil("not-a-date")).toBeNull();
  });
});
