import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { seedFixture } from "../seed/seed.fixture.js";
import { insertTransaction } from "../db/repository.js";
import type { NewTransaction } from "../db/repository.js";
import { nextPayday, parseDiasPago, paydaysAfter, paydaysBetween } from "./calendar.js";
import { localDayKey } from "./dates.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

function sueldoTx(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    gmail_msg_id: `sueldo-${Math.random()}`,
    ts: "2026-06-04T15:00:00Z",
    direction: "in",
    type: "sueldo",
    amount: 1180,
    ...overrides,
  };
}

describe("parseDiasPago", () => {
  it("parses a '<=N' spec as [1, N]", () => {
    expect(parseDiasPago(["<=5"])).toEqual([{ minDay: 1, maxDay: 5 }]);
  });

  it("parses an 'A-B' range spec as [A, B]", () => {
    expect(parseDiasPago(["18-20"])).toEqual([{ minDay: 18, maxDay: 20 }]);
  });

  it("parses multiple specs in order", () => {
    expect(parseDiasPago(["<=5", "18-20"])).toEqual([
      { minDay: 1, maxDay: 5 },
      { minDay: 18, maxDay: 20 },
    ]);
  });

  it("skips an unparseable spec instead of throwing", () => {
    expect(parseDiasPago(["quincenal", "18-20"])).toEqual([{ minDay: 18, maxDay: 20 }]);
  });

  it("skips an inverted range (min > max)", () => {
    expect(parseDiasPago(["20-18"])).toEqual([]);
  });

  it("returns an empty array for an empty input", () => {
    expect(parseDiasPago([])).toEqual([]);
  });
});

describe("paydaysAfter / nextPayday (spec §9.1, no ledger history)", () => {
  it("predicts the config windows' upper-bound day when no sueldo history exists", () => {
    seedFixture(db); // fixture diasPago: ["<=5", "18-20"]
    const from = new Date("2026-07-10T12:00:00.000Z"); // local time: July 10

    const dates = paydaysAfter(db, from, 2).map((d) => localDayKey(d));

    expect(dates).toEqual(["2026-07-20", "2026-08-05"]);
  });

  it("nextPayday returns the single next predicted payday as an local YYYY-MM-DD string", () => {
    seedFixture(db);
    const from = new Date("2026-07-10T12:00:00.000Z");

    expect(nextPayday(db, from)).toBe("2026-07-20");
  });

  it("rolls into the next month when `from` is already past both windows", () => {
    seedFixture(db);
    const from = new Date("2026-07-25T12:00:00.000Z");

    expect(nextPayday(db, from)).toBe("2026-08-05");
  });

  it("returns null when diasPago has no parseable windows", () => {
    seedFixture(db);
    db.prepare("UPDATE strategy_config SET value = ? WHERE key = 'sueldo'").run(
      JSON.stringify({ fuente: "x", cadencia: "x", montoEstimado: 100, diasPago: [] })
    );

    expect(nextPayday(db, new Date("2026-07-10T12:00:00.000Z"))).toBeNull();
  });
});

describe("paydaysAfter (refined against real ledger history, spec §9.1)", () => {
  it("uses the rounded average historical day-of-month for a window with matching sueldo rows", () => {
    seedFixture(db);
    // Two historical paydays inside the "18-20" window: the 18th and the 19th -> average 18.5 -> rounds to 19 (banker's-off, Math.round rounds .5 up).
    insertTransaction(db, sueldoTx({ gmail_msg_id: "s1", ts: "2026-05-18T15:00:00Z" }));
    insertTransaction(db, sueldoTx({ gmail_msg_id: "s2", ts: "2026-06-19T15:00:00Z" }));

    const from = new Date("2026-07-01T12:00:00.000Z");
    const dates = paydaysAfter(db, from, 2).map((d) => localDayKey(d));

    // First window ("<=5") has no history -> falls back to its upper bound (5).
    // Second window ("18-20") has history -> refined to 19.
    expect(dates).toEqual(["2026-07-05", "2026-07-19"]);
  });

  it("ignores a historical sueldo row that falls outside every configured window", () => {
    seedFixture(db);
    insertTransaction(db, sueldoTx({ gmail_msg_id: "s1", ts: "2026-05-12T15:00:00Z" })); // outside both windows

    const from = new Date("2026-07-01T12:00:00.000Z");
    const dates = paydaysAfter(db, from, 1).map((d) => localDayKey(d));

    expect(dates).toEqual(["2026-07-05"]); // unaffected fallback
  });
});

describe("paydaysBetween (spec §9.5 support)", () => {
  it("returns every predicted payday strictly after `from` and on/before `until`", () => {
    seedFixture(db);
    const from = new Date("2026-07-01T12:00:00.000Z");
    const until = new Date("2026-08-10T12:00:00.000Z");

    const dates = paydaysBetween(db, from, until).map((d) => localDayKey(d));

    expect(dates).toEqual(["2026-07-05", "2026-07-20", "2026-08-05"]);
  });

  it("returns an empty array when `until` is not after `from`", () => {
    seedFixture(db);
    const from = new Date("2026-07-10T12:00:00.000Z");
    expect(paydaysBetween(db, from, from)).toEqual([]);
    expect(paydaysBetween(db, from, new Date("2026-07-01T12:00:00.000Z"))).toEqual([]);
  });

  // TASK-025 review LOW: paydaysAfter used to scan a hardcoded 3 months
  // ahead regardless of how many candidates were actually requested, so a
  // due date further out than that (a card's fechaMaxima several months
  // away) silently undercounted paydays -- and tarjetaStatus.aTiempo would
  // read pessimistically wrong as a result. The lookahead must scale to
  // cover whatever range is actually asked for.
  it("does not undercount paydays for an `until` more than 3 months past `from`", () => {
    seedFixture(db); // fixture diasPago: ["<=5", "18-20"] -> 2 paydays/month
    const from = new Date("2026-07-20T12:00:00.000Z"); // local time: July 20
    const until = new Date("2027-01-20T12:00:00.000Z"); // 6 months out, local time: Jan 20

    const dates = paydaysBetween(db, from, until).map((d) => localDayKey(d));

    expect(dates).toEqual([
      "2026-08-05",
      "2026-08-20",
      "2026-09-05",
      "2026-09-20",
      "2026-10-05",
      "2026-10-20",
      "2026-11-05",
      "2026-11-20",
      "2026-12-05",
      "2026-12-20",
      "2027-01-05",
      "2027-01-20",
    ]);
  });
});
