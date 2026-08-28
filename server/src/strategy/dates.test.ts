import { describe, expect, it } from "vitest";
import {
  addDays,
  daysBetween,
  localDayKey,
  localCalendarDate,
  localMonthRange,
  localParts,
  parseLocalDay,
} from "./dates.js";

describe("localDayKey", () => {
  it("returns the local calendar day for a UTC instant late in the UTC day", () => {
    // 04:00 UTC on the 20th = 23:00 on the 19th in local time (UTC-5)
    expect(localDayKey("2026-07-20T04:00:00.000Z")).toBe("2026-07-19");
  });

  it("returns the local calendar day for a UTC instant that stays on the same day", () => {
    // 12:00 UTC on the 20th = 07:00 on the 20th in local time
    expect(localDayKey("2026-07-20T12:00:00.000Z")).toBe("2026-07-20");
  });

  it("returns null for an unparseable timestamp instead of throwing", () => {
    expect(localDayKey("not-a-date")).toBeNull();
  });

  it("accepts a Date instance directly", () => {
    expect(localDayKey(new Date("2026-07-20T12:00:00.000Z"))).toBe("2026-07-20");
  });
});

describe("localParts", () => {
  it("extracts local year/monthIndex/day", () => {
    expect(localParts(new Date("2026-07-20T12:00:00.000Z"))).toEqual({
      year: 2026,
      monthIndex: 6,
      day: 20,
    });
  });
});

describe("localCalendarDate", () => {
  it("round-trips through localDayKey", () => {
    const date = localCalendarDate(2026, 6, 20);
    expect(localDayKey(date)).toBe("2026-07-20");
  });

  it("represents local midnight as 05:00 UTC", () => {
    const date = localCalendarDate(2026, 6, 20);
    expect(date.toISOString()).toBe("2026-07-20T05:00:00.000Z");
  });

  it("clamps an out-of-range day to the last real day of the month instead of overflowing", () => {
    // February 2026 has 28 days
    const date = localCalendarDate(2026, 1, 30);
    expect(localDayKey(date)).toBe("2026-02-28");
  });
});

describe("parseLocalDay", () => {
  it("parses a YYYY-MM-DD string as local midnight", () => {
    const date = parseLocalDay("2026-07-20");
    expect(date?.toISOString()).toBe("2026-07-20T05:00:00.000Z");
  });

  it("returns null for a malformed date string instead of throwing", () => {
    expect(parseLocalDay("20/07/2026")).toBeNull();
    expect(parseLocalDay("")).toBeNull();
  });
});

describe("localMonthRange", () => {
  it("returns the half-open [firstOfMonth, firstOfNextMonth) bounds for the given instant", () => {
    const { from, to } = localMonthRange(new Date("2026-07-20T12:00:00.000Z"));
    expect(localDayKey(from)).toBe("2026-07-01");
    expect(localDayKey(to)).toBe("2026-08-01");
  });

  it("rolls over the year boundary correctly for December", () => {
    const { from, to } = localMonthRange(new Date("2026-12-15T12:00:00.000Z"));
    expect(localDayKey(from)).toBe("2026-12-01");
    expect(localDayKey(to)).toBe("2027-01-01");
  });
});

describe("daysBetween", () => {
  it("counts whole days between two instants, rounding a partial day up", () => {
    const from = new Date("2026-07-20T00:00:00.000Z");
    const to = new Date("2026-07-25T00:00:00.000Z");
    expect(daysBetween(from, to)).toBe(5);
  });

  it("rounds a partial trailing day up to a full day", () => {
    const from = new Date("2026-07-20T00:00:00.000Z");
    const to = new Date("2026-07-20T06:00:00.000Z");
    expect(daysBetween(from, to)).toBe(1);
  });

  it("returns a negative count when `to` is before `from`", () => {
    const from = new Date("2026-07-25T00:00:00.000Z");
    const to = new Date("2026-07-20T00:00:00.000Z");
    expect(daysBetween(from, to)).toBe(-5);
  });

  it("returns 0 for identical instants", () => {
    const now = new Date("2026-07-20T00:00:00.000Z");
    expect(daysBetween(now, now)).toBe(0);
  });
});

describe("addDays", () => {
  it("adds whole days preserving the local wall-clock time", () => {
    const date = localCalendarDate(2026, 6, 20);
    expect(localDayKey(addDays(date, 1))).toBe("2026-07-21");
    expect(localDayKey(addDays(date, -1))).toBe("2026-07-19");
  });
});
