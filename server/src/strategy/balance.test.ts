import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { DEFAULT_STRATEGY_CONFIG } from "../seed/default-config.js";
import { seedFixture } from "../seed/seed.fixture.js";
import { insertTransaction, insertStatement } from "../db/repository.js";
import type { NewTransaction } from "../db/repository.js";
import { balanceActual, colchonStatus, safeToSpendHoy } from "./balance.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

function tx(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    gmail_msg_id: `tx-${Math.random()}`,
    ts: "2026-07-22T12:00:00Z",
    direction: "out",
    type: "debito",
    amount: 10,
    ...overrides,
  };
}

function setSueldo(diasPago: string[]): void {
  db.prepare("UPDATE strategy_config SET value = ? WHERE key = 'sueldo'").run(
    JSON.stringify({ fuente: "Acme", cadencia: "quincenal", montoEstimado: 1000, diasPago })
  );
}

describe("balanceActual (spec §9.2)", () => {
  it("returns the snapshot amount unchanged when the ledger has no transactions after it", () => {
    seedFixture(db); // fixture balanceSnapshot: { amount: 2409, at: "2026-07-20" }

    expect(balanceActual(db, new Date("2026-07-21T12:00:00Z"))).toBe(2409);
  });

  it("adds ingresos and subtracts gastos strictly after the snapshot day", () => {
    seedFixture(db);
    insertTransaction(db, tx({ gmail_msg_id: "in1", direction: "in", type: "sueldo", amount: 100, ts: "2026-07-22T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "out1", direction: "out", type: "debito", amount: 30.25, ts: "2026-07-23T12:00:00Z" }));

    expect(balanceActual(db, new Date("2026-07-25T12:00:00Z"))).toBe(2409 + 100 - 30.25);
  });

  it("does NOT count a transaction dated on the snapshot day itself (already reflected in the snapshot)", () => {
    seedFixture(db); // snapshot.at = '2026-07-20'
    insertTransaction(db, tx({ gmail_msg_id: "sameday", direction: "out", amount: 500, ts: "2026-07-20T18:00:00Z" }));

    expect(balanceActual(db, new Date("2026-07-25T12:00:00Z"))).toBe(2409);
  });

  it("does NOT count a transaction after `now` (future relative to the query instant)", () => {
    seedFixture(db);
    insertTransaction(db, tx({ gmail_msg_id: "future", direction: "in", amount: 500, ts: "2026-08-01T12:00:00Z" }));

    expect(balanceActual(db, new Date("2026-07-25T12:00:00Z"))).toBe(2409);
  });

  it("excludes is_internal transactions from the delta", () => {
    seedFixture(db);
    insertTransaction(db, tx({ gmail_msg_id: "internal", direction: "out", type: "transferencia", amount: 200, is_internal: true }));

    expect(balanceActual(db, new Date("2026-07-25T12:00:00Z"))).toBe(2409);
  });

  it("excludes is_reversed transactions from the delta", () => {
    seedFixture(db);
    insertTransaction(db, tx({ gmail_msg_id: "reversed", direction: "out", amount: 40, is_reversed: true }));

    expect(balanceActual(db, new Date("2026-07-25T12:00:00Z"))).toBe(2409);
  });

  it("excludes needs_review transactions from the delta", () => {
    seedFixture(db);
    insertTransaction(db, tx({ gmail_msg_id: "review", direction: "out", amount: 60, needs_review: true }));

    expect(balanceActual(db, new Date("2026-07-25T12:00:00Z"))).toBe(2409);
  });

  it("excludes type='reverso' audit rows (would otherwise double-count against the already-excluded is_reversed consumo)", () => {
    seedFixture(db);
    insertTransaction(db, tx({ gmail_msg_id: "reverso-audit", direction: "in", type: "reverso", amount: 15 }));

    expect(balanceActual(db, new Date("2026-07-25T12:00:00Z"))).toBe(2409);
  });

  it("returns 0 -- never a fabricated figure -- on a completely empty database (no seed, no transactions)", () => {
    // An unconfigured wallet must report zero, not an inherited example
    // balance: the shipped `balanceSnapshot` default is {amount: 0} exactly
    // so a fresh clone can't display a number that belongs to nobody.
    expect(DEFAULT_STRATEGY_CONFIG.balanceSnapshot.amount).toBe(0);
    expect(() => balanceActual(db, new Date("2026-07-25T12:00:00Z"))).not.toThrow();
    expect(balanceActual(db, new Date("2026-07-25T12:00:00Z"))).toBe(0);
  });
});

describe("colchonStatus (spec §9.3)", () => {
  it("reports the config objetivo against the savings 'colchon' row's reserved amount", () => {
    seedFixture(db); // colchonObjetivo: 1200, savings.colchon.reserved: 0

    expect(colchonStatus(db)).toEqual({ objetivo: 1200, reservado: 0, financiado: false, faltante: 1200 });
  });

  it("marks financiado true and faltante 0 once reserved meets the objetivo exactly", () => {
    seedFixture(db);
    db.prepare("UPDATE savings SET reserved = 1200 WHERE label = 'colchon'").run();

    expect(colchonStatus(db)).toEqual({ objetivo: 1200, reservado: 1200, financiado: true, faltante: 0 });
  });

  it("clamps faltante at 0 (never negative) when reserved exceeds the objetivo", () => {
    seedFixture(db);
    db.prepare("UPDATE savings SET reserved = 1500 WHERE label = 'colchon'").run();

    expect(colchonStatus(db)).toEqual({ objetivo: 1200, reservado: 1500, financiado: true, faltante: 0 });
  });

  it("degrades to reservado 0 without crashing when there is no savings row at all", () => {
    expect(() => colchonStatus(db)).not.toThrow();
    const status = colchonStatus(db);
    expect(status.reservado).toBe(0);
    // Unconfigured: the shipped default objetivo is 0, so an un-onboarded
    // wallet reports "nothing to reach" rather than an invented target.
    expect(status.objetivo).toBe(DEFAULT_STRATEGY_CONFIG.colchonObjetivo);
    expect(status.objetivo).toBe(0);
    expect(status.faltante).toBe(0);
  });
});

describe("safeToSpendHoy (spec §9.4)", () => {
  it("computes the exact formula: max(0, (disponible - colchon - tarjeta - esenciales) / diasHastaProximoPago)", () => {
    seedFixture(db);
    db.prepare("UPDATE strategy_config SET value = ? WHERE key = 'colchonObjetivo'").run(JSON.stringify(1000));
    db.prepare("UPDATE strategy_config SET value = ? WHERE key = 'balanceSnapshot'").run(
      JSON.stringify({ amount: 2000, at: "2026-07-01" })
    );
    setSueldo(["25-25"]); // single predictable payday: the 25th

    // disponible = 2000 + 1000 (sueldo ingreso) - 50 (recarga gasto) = 2950
    insertTransaction(db, tx({ gmail_msg_id: "income", direction: "in", type: "sueldo", amount: 1000, ts: "2026-07-15T15:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "spend", direction: "out", type: "recarga", amount: 50, ts: "2026-07-16T15:00:00Z" }));

    // colchon reservado = 300
    db.prepare("UPDATE savings SET reserved = 300 WHERE label = 'colchon'").run();

    // tarjeta saldoCorte = 150
    insertStatement(db, { gmail_msg_id: "stmt-1", balance: 150, min_payment: 20, issue_date: "2026-06-01", due_date: "2026-07-05" });

    // esenciales historico: 3 days of $30 debito/servicio/retiro (avg $30/day), all well before `now`
    insertTransaction(db, tx({ gmail_msg_id: "e1", direction: "out", type: "debito", amount: 30, ts: "2026-06-10T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "e2", direction: "out", type: "servicio", amount: 30, ts: "2026-06-11T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "e3", direction: "out", type: "retiro", amount: 30, ts: "2026-06-12T12:00:00Z" }));
    // a transferencia must NOT count toward esenciales even though it's a real gasto
    insertTransaction(db, tx({ gmail_msg_id: "transfer", direction: "out", type: "transferencia", amount: 500, ts: "2026-06-10T12:00:00Z" }));

    const now = new Date("2026-07-20T12:00:00.000Z");
    // nextPayday(now) = 2026-07-25 -> diasHastaProximoPago = ceil((25T05:00 - 20T12:00) / day) = 5
    // esenciales = 30 * 5 = 150
    // (2950 - 300 - 150 - 150) / 5 = 2350 / 5 = 470
    expect(safeToSpendHoy(db, now)).toBe(470);
  });

  it("clamps at 0 instead of going negative when obligations exceed what's available", () => {
    seedFixture(db);
    db.prepare("UPDATE strategy_config SET value = ? WHERE key = 'balanceSnapshot'").run(
      JSON.stringify({ amount: 100, at: "2026-07-01" })
    );
    setSueldo(["25-25"]);
    db.prepare("UPDATE savings SET reserved = 500 WHERE label = 'colchon'").run(); // colchon alone exceeds balance

    expect(safeToSpendHoy(db, new Date("2026-07-20T12:00:00.000Z"))).toBe(0);
  });

  it("returns 0 (never divides by zero) when there is no predictable next payday", () => {
    seedFixture(db);
    setSueldo([]); // no parseable diasPago windows -> nextPayday() is null

    expect(safeToSpendHoy(db, new Date("2026-07-20T12:00:00.000Z"))).toBe(0);
  });

  it("never crashes on a completely empty database and returns a sane, non-negative number", () => {
    // No seed at all: getStrategyConfig falls back to the shipped defaults,
    // and no transactions/statements/savings exist.
    expect(() => safeToSpendHoy(db, new Date("2026-07-10T12:00:00.000Z"))).not.toThrow();
    const result = safeToSpendHoy(db, new Date("2026-07-10T12:00:00.000Z"));
    expect(result).toBeGreaterThanOrEqual(0);
    // Zero balance, no colchon/tarjeta/esenciales -> 0 available to spend.
    // The point of the assertion is that an un-onboarded wallet says "0",
    // not that it invents a number it can't justify.
    expect(result).toBe(0);
  });

  // TASK-025 review MEDIUM: an unparseable ts on an essential-type row must
  // never turn into NaN on this headline number. The essentials average's
  // min/max ts span used `new Date(minTs)`/`new Date(maxTs)` without ever
  // validating `ts` first (unlike every other date-consuming spot in this
  // package -- e.g. calendar.ts's historicalPaydayDays already skips an
  // unparseable ts). An Invalid Date there makes daysBetween return NaN,
  // Math.max(1, NaN) is NaN (not 1 -- Math.max propagates any NaN argument),
  // and that NaN silently rides all the way through to safeToSpendHoy's
  // return value.
  it("never returns NaN when an essential-type row has an unparseable ts (uses only the valid-ts rows)", () => {
    seedFixture(db);
    db.prepare("UPDATE strategy_config SET value = ? WHERE key = 'balanceSnapshot'").run(
      JSON.stringify({ amount: 1000, at: "2026-07-01" })
    );
    setSueldo(["25-25"]);

    insertTransaction(db, tx({ gmail_msg_id: "bad-ts", direction: "out", type: "debito", amount: 50, ts: "not-a-date" }));

    const now = new Date("2026-07-20T12:00:00.000Z");
    const result = safeToSpendHoy(db, now);

    expect(result).not.toBeNaN();
    // the invalid-ts row is skipped entirely -> esenciales average is 0 ->
    // (1000 - 0 - 0 - 0) / 5 = 200
    expect(result).toBe(200);
  });
});
