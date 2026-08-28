/**
 * Local 08:00 local time scheduler that triggers daily brief
 * generation (spec §13 AC5, F2-F / TASK-027). Deliberately NOT node-cron
 * (Ponytail minimalism: a single fixed daily trigger needs nothing beyond
 * `setTimeout`, and adding a scheduling dependency for one job is the wrong
 * rung of the ladder) and NOT an OS-level cron job (the app must trigger the
 * brief identically on every machine it runs on -- dev laptop today, an
 * eventual host tomorrow -- without out-of-band OS configuration).
 *
 * `startDailyBriefScheduler` computes the next local 08:00 instant,
 * `setTimeout`s to it, runs `onTrigger`, then reschedules for the following
 * day -- forever, until `stop()` is called. This module only fires the
 * trigger callback; it does NOT itself deliver the brief anywhere (email/
 * notification delivery is out of this ticket's scope) -- the caller
 * (server/src/index.ts) decides what "trigger" means, today just building
 * the brief and logging it.
 *
 * Wiring: only started from index.ts's `listen()` path (real server boot),
 * never from `createApp()` -- so it never starts under `npm test`, where
 * `createApp()` is constructed directly without ever calling `listen()`.
 *
 * The real timer loop (`startDailyBriefScheduler`) is not unit-tested: a
 * timer scheduled hours-to-a-full-day out isn't something a fast suite
 * should fake-timer its way through reliably (`setTimeout`'s ms argument
 * here is a real wall-clock delta, not a fake-timer-friendly tick-count).
 * `nextTriggerInstant`, however, is a pure `now -> next trigger` function
 * that takes `now` as an argument, so that rationale doesn't apply to it --
 * it's covered directly by scheduler.test.ts (see that file's H1 regression
 * case: the last day of any month, where a naive `day + 1` would clamp back
 * to today via `localCalendarDate` instead of rolling into next month).
 */
import { addDays, localCalendarDate, localParts } from "../strategy/index.js";

const BRIEF_TRIGGER_HOUR_LOCAL = 8;

/** local midnight of (year, monthIndex, day) shifted forward by `hour` whole hours. */
function localCalendarDateTime(year: number, monthIndex: number, day: number, hour: number): Date {
  const midnight = localCalendarDate(year, monthIndex, day);
  return new Date(midnight.getTime() + hour * 60 * 60 * 1000);
}

/** The next local instant at `hour`:00 strictly after `now` -- today's
 * if it hasn't happened yet, otherwise tomorrow's. Exported for readability/
 * documentation purposes; not covered by a timing test (see module doc). */
export function nextTriggerInstant(now: Date, hour: number = BRIEF_TRIGGER_HOUR_LOCAL): Date {
  const { year, monthIndex, day } = localParts(now);
  const todayTrigger = localCalendarDateTime(year, monthIndex, day, hour);
  if (todayTrigger.getTime() > now.getTime()) return todayTrigger;
  // Shift by a fixed +24h instead of rebuilding via `day + 1` -- that would
  // route back through localCalendarDate's clamping constructor, which caps
  // an out-of-range day at the month's last real day instead of overflowing
  // into the next month. On the last day of any month that clamp lands back
  // on *today's* already-past trigger, producing a zero/negative delay that
  // busy-loops the scheduler. `addDays` is a plain +24h shift, which is safe
  // here since the configured offset has no DST to trip over.
  return addDays(todayTrigger, 1);
}

export interface DailyBriefSchedulerHandle {
  /** Cancels the pending timer and stops future rescheduling. */
  stop: () => void;
}

/**
 * Starts the recurring 08:00 local time trigger. `onTrigger` runs
 * once per day at that instant; a thrown/rejected `onTrigger` is logged by
 * the caller's own instrumentation (this module doesn't wrap it) but never
 * stops the next day's schedule -- one bad run shouldn't silence the brief
 * forever. `nowFn` is injectable for callers that want to reason about "now"
 * consistently elsewhere; defaults to the real clock.
 */
export function startDailyBriefScheduler(onTrigger: () => void, nowFn: () => Date = () => new Date()): DailyBriefSchedulerHandle {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  function scheduleNext(): void {
    if (stopped) return;
    const target = nextTriggerInstant(nowFn());
    const delayMs = Math.max(0, target.getTime() - nowFn().getTime());
    timer = setTimeout(() => {
      if (stopped) return;
      try {
        onTrigger();
      } finally {
        scheduleNext();
      }
    }, delayMs);
    // Never let this pending timer alone keep the Node process alive.
    timer.unref?.();
  }

  scheduleNext();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
