/**
 * nextTriggerInstant (F2-F / TASK-027 scheduler, tdd regression): pure date
 * function so it's testable despite the module doc's blanket "not
 * unit-tested" note about the day-long `setTimeout` timer -- that rationale
 * covers `startDailyBriefScheduler`'s real wall-clock delay, not this pure
 * `now -> next trigger` calculation. Covers the H1 bug where computing
 * tomorrow's trigger via `localCalendarDate(..., day + 1, ...)` clamps back to
 * today on the last day of any month (`localCalendarDate` clamps out-of-range
 * days instead of overflowing), producing a past instant and a scheduler
 * busy-loop.
 */
import { describe, expect, it } from "vitest";
import { nextTriggerInstant } from "./scheduler.js";

describe("nextTriggerInstant", () => {
  it("returns today's 08:00 local time when now is mid-month before the trigger hour", () => {
    // 2026-07-15T10:00:00Z = 05:00 local time, before 08:00
    const now = new Date("2026-07-15T10:00:00.000Z");
    expect(nextTriggerInstant(now).toISOString()).toBe("2026-07-15T13:00:00.000Z");
  });

  it("returns tomorrow's 08:00 local time when now is mid-month after the trigger hour", () => {
    // 2026-07-15T14:00:00Z = 09:00 local time, after 08:00
    const now = new Date("2026-07-15T14:00:00.000Z");
    expect(nextTriggerInstant(now).toISOString()).toBe("2026-07-16T13:00:00.000Z");
  });

  it("rolls over into next month instead of clamping back to today on the last day of the month", () => {
    // 2026-07-31T15:00:00Z = 10:00 local time on July 31st, after 08:00
    const now = new Date("2026-07-31T15:00:00.000Z");
    const next = nextTriggerInstant(now);
    expect(next.toISOString()).toBe("2026-08-01T13:00:00.000Z");
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });

  it("rolls over the year boundary on December 31st after the trigger hour", () => {
    // 2026-12-31T14:00:00Z = 09:00 local time on Dec 31st, after 08:00
    const now = new Date("2026-12-31T14:00:00.000Z");
    const next = nextTriggerInstant(now);
    expect(next.toISOString()).toBe("2027-01-01T13:00:00.000Z");
    expect(next.getTime()).toBeGreaterThan(now.getTime());
  });
});
