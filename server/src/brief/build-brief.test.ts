/**
 * buildDailyBrief (spec §13 + §10.2, F2-F / TASK-027, tdd): the daily brief
 * that replaces the ad-hoc spending report the user used to get manually --
 * total gastado de ayer, top consumos, comparación vs promedio histórico,
 * alertas de estrategia (§10.2), y el recordatorio de abonar a la tarjeta
 * cuando llegó el sueldo. Every figure is sourced from the F2-C engine
 * (transferenciasMes/colchonStatus/tarjetaStatus) or a direct ledger query
 * using the exact same exclusion clause the engine applies everywhere
 * (EXCLUDE_FROM_TOTALS_SQL) -- this suite pins the brief and each alert
 * condition against fixtures, per the ticket's guidance.
 */
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { seedDatabase } from "../seed/seed.js";
import { insertStatement, insertTransaction } from "../db/repository.js";
import type { NewTransaction } from "../db/repository.js";
import { buildDailyBrief } from "./build-brief.js";

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
    ts: "2026-07-10T12:00:00Z",
    direction: "out",
    type: "debito",
    amount: 10,
    ...overrides,
  };
}

function setConfig(key: string, value: unknown): void {
  db.prepare(
    `INSERT INTO strategy_config (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run({ key, value: JSON.stringify(value) });
}

// local July 10, 2026 -- picked mid-month so the colchon "close to
// month end" alert never fires by accident in unrelated tests.
const TARGET_DAY = "2026-07-10";
const NOW_MIDDAY = new Date("2026-07-10T17:00:00.000Z"); // 12:00 local time on the target day

describe("buildDailyBrief (spec §13) -- totalGastado / topConsumos", () => {
  it("sums the target day's GASTO rows and ranks topConsumos by amount, applying the shared exclusions", () => {
    insertTransaction(db, tx({ gmail_msg_id: "g1", counterparty: "Supermaxi", amount: 30, ts: "2026-07-10T13:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "g2", counterparty: "Netflix", type: "servicio", amount: 15, ts: "2026-07-10T14:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "g3", counterparty: "Juan", type: "transferencia", amount: 55, ts: "2026-07-10T15:00:00Z" }));

    // Same-day rows that must NOT count.
    insertTransaction(db, tx({ gmail_msg_id: "in", direction: "in", amount: 500, ts: "2026-07-10T09:00:00Z" })); // ingreso, not gasto
    insertTransaction(db, tx({ gmail_msg_id: "internal", is_internal: true, amount: 40, ts: "2026-07-10T10:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "reversed", is_reversed: true, amount: 40, ts: "2026-07-10T10:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "review", needs_review: true, amount: 40, ts: "2026-07-10T10:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "reverso", type: "reverso", direction: "in", amount: 40, ts: "2026-07-10T10:00:00Z" }));
    // A different day's row must not count either.
    insertTransaction(db, tx({ gmail_msg_id: "other-day", amount: 999, ts: "2026-07-09T12:00:00Z" }));

    const brief = buildDailyBrief(db, { date: TARGET_DAY, now: NOW_MIDDAY });

    expect(brief.date).toBe(TARGET_DAY);
    expect(brief.totalGastado).toBe(100); // 30 + 15 + 55
    expect(brief.topConsumos).toEqual([
      { counterparty: "Juan", type: "transferencia", amount: 55 },
      { counterparty: "Supermaxi", type: "debito", amount: 30 },
      { counterparty: "Netflix", type: "servicio", amount: 15 },
    ]);
  });

  it("caps topConsumos at the top 5 by amount, descending", () => {
    const amounts = [10, 60, 20, 50, 30, 40]; // 6 transactions
    amounts.forEach((amount, i) => {
      insertTransaction(db, tx({ gmail_msg_id: `t${i}`, counterparty: `C${i}`, amount, ts: "2026-07-10T13:00:00Z" }));
    });

    const brief = buildDailyBrief(db, { date: TARGET_DAY, now: NOW_MIDDAY });

    expect(brief.topConsumos).toHaveLength(5);
    expect(brief.topConsumos.map((c) => c.amount)).toEqual([60, 50, 40, 30, 20]); // drops the smallest (10)
  });
});

describe("buildDailyBrief -- vsPromedio", () => {
  it("compares the target day's total against the historical daily-spend average", () => {
    // Historical out-spend on other days: 07-01 ($40) and 07-03 ($20).
    insertTransaction(db, tx({ gmail_msg_id: "hist-1", amount: 40, ts: "2026-07-01T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "hist-2", amount: 20, ts: "2026-07-03T12:00:00Z" }));
    // Target day: $100.
    insertTransaction(db, tx({ gmail_msg_id: "today", amount: 100, ts: "2026-07-10T12:00:00Z" }));

    const brief = buildDailyBrief(db, { date: TARGET_DAY, now: NOW_MIDDAY });

    // total out-spend across the whole ledger (40+20+100=160) / span days
    // (07-01 to 07-10 inclusive = 10 days) = 16.00/day.
    expect(brief.vsPromedio).toEqual({ dia: 100, promedio: 16, diferencia: 84 });
  });
});

describe("buildDailyBrief -- alertas (spec §10.2)", () => {
  it("fires transferencias_cerca_tope when the month's transfers reach >=90% of the tope", () => {
    setConfig("topeTransferenciasMensual", 100);
    insertTransaction(db, tx({ gmail_msg_id: "x1", type: "transferencia", counterparty: "Juan", amount: 95, ts: "2026-07-05T12:00:00Z" }));

    const brief = buildDailyBrief(db, { date: TARGET_DAY, now: NOW_MIDDAY });

    expect(brief.alertas.some((a) => a.type === "transferencias_cerca_tope")).toBe(true);
  });

  it("does not fire transferencias_cerca_tope comfortably below the tope", () => {
    setConfig("topeTransferenciasMensual", 100);
    insertTransaction(db, tx({ gmail_msg_id: "x1", type: "transferencia", counterparty: "Juan", amount: 50, ts: "2026-07-05T12:00:00Z" }));

    const brief = buildDailyBrief(db, { date: TARGET_DAY, now: NOW_MIDDAY });

    expect(brief.alertas.some((a) => a.type === "transferencias_cerca_tope")).toBe(false);
  });

  it("fires colchon_no_financiado when unfunded and within days of month end", () => {
    setConfig("colchonObjetivo", 500);
    db.prepare("INSERT INTO savings (label, target, reserved, updated_at) VALUES ('colchon', 500, 0, datetime('now'))").run();

    const nearMonthEnd = new Date("2026-07-28T17:00:00.000Z"); // July 28 local time -- 3 days left in July
    const brief = buildDailyBrief(db, { date: TARGET_DAY, now: nearMonthEnd });

    expect(brief.alertas.some((a) => a.type === "colchon_no_financiado")).toBe(true);
  });

  it("does not fire colchon_no_financiado when funded, even near month end", () => {
    setConfig("colchonObjetivo", 500);
    db.prepare("INSERT INTO savings (label, target, reserved, updated_at) VALUES ('colchon', 500, 500, datetime('now'))").run();

    const nearMonthEnd = new Date("2026-07-28T17:00:00.000Z");
    const brief = buildDailyBrief(db, { date: TARGET_DAY, now: nearMonthEnd });

    expect(brief.alertas.some((a) => a.type === "colchon_no_financiado")).toBe(false);
  });

  it("does not fire colchon_no_financiado when unfunded but far from month end", () => {
    setConfig("colchonObjetivo", 500);
    db.prepare("INSERT INTO savings (label, target, reserved, updated_at) VALUES ('colchon', 500, 0, datetime('now'))").run();

    const brief = buildDailyBrief(db, { date: TARGET_DAY, now: NOW_MIDDAY }); // July 10 -- well over 5 days left

    expect(brief.alertas.some((a) => a.type === "colchon_no_financiado")).toBe(false);
  });

  it("fires tarjeta_riesgo_atraso when aTiempo is false", () => {
    insertStatement(db, { gmail_msg_id: "stmt-1", balance: 150, issue_date: "2026-07-01", due_date: "2026-07-22" });
    setConfig("sueldo", { fuente: "Acme", cadencia: "quincenal", montoEstimado: 1000, diasPago: ["15-15"] }); // July 15 already passed; next payday Aug 15, after the due date

    const now = new Date("2026-07-20T17:00:00.000Z"); // July 20 local time
    const brief = buildDailyBrief(db, { date: TARGET_DAY, now });

    expect(brief.alertas.some((a) => a.type === "tarjeta_riesgo_atraso")).toBe(true);
  });

  it("does not fire tarjeta_riesgo_atraso when aTiempo is true or there is no statement", () => {
    const brief = buildDailyBrief(db, { date: TARGET_DAY, now: NOW_MIDDAY }); // no statement at all

    expect(brief.alertas.some((a) => a.type === "tarjeta_riesgo_atraso")).toBe(false);
  });
});

describe("buildDailyBrief -- recordatorioTarjeta", () => {
  it("is true when a recent sueldo landed and the card carries a balance", () => {
    insertStatement(db, { gmail_msg_id: "stmt-1", balance: 150, issue_date: "2026-07-01", due_date: "2026-08-01" });
    insertTransaction(
      db,
      tx({ gmail_msg_id: "sueldo-1", type: "sueldo", direction: "in", amount: 1000, ts: "2026-07-09T12:00:00Z" })
    );

    const brief = buildDailyBrief(db, { date: TARGET_DAY, now: NOW_MIDDAY });

    expect(brief.recordatorioTarjeta).toBe(true);
  });

  it("is false when there is no recent sueldo", () => {
    insertStatement(db, { gmail_msg_id: "stmt-1", balance: 150, issue_date: "2026-07-01", due_date: "2026-08-01" });

    const brief = buildDailyBrief(db, { date: TARGET_DAY, now: NOW_MIDDAY });

    expect(brief.recordatorioTarjeta).toBe(false);
  });

  it("is false when the sueldo is recent but the card carries no balance (already paid)", () => {
    insertStatement(db, { gmail_msg_id: "stmt-1", balance: 0, issue_date: "2026-07-01", due_date: "2026-08-01" });
    insertTransaction(
      db,
      tx({ gmail_msg_id: "sueldo-1", type: "sueldo", direction: "in", amount: 1000, ts: "2026-07-09T12:00:00Z" })
    );

    const brief = buildDailyBrief(db, { date: TARGET_DAY, now: NOW_MIDDAY });

    expect(brief.recordatorioTarjeta).toBe(false);
  });

  it("is false when there is no statement at all, even with a recent sueldo", () => {
    insertTransaction(
      db,
      tx({ gmail_msg_id: "sueldo-1", type: "sueldo", direction: "in", amount: 1000, ts: "2026-07-09T12:00:00Z" })
    );

    const brief = buildDailyBrief(db, { date: TARGET_DAY, now: NOW_MIDDAY });

    expect(brief.recordatorioTarjeta).toBe(false);
  });
});

describe("buildDailyBrief -- defaults and degradation", () => {
  it("defaults `date` to yesterday in local time relative to `now` when omitted", () => {
    insertTransaction(db, tx({ gmail_msg_id: "yday", amount: 42, ts: "2026-07-09T12:00:00Z" }));

    const brief = buildDailyBrief(db, { now: new Date("2026-07-10T13:00:00.000Z") }); // 08:00 local time July 10

    expect(brief.date).toBe("2026-07-09");
    expect(brief.totalGastado).toBe(42);
  });

  it("degrades to a clean zero/empty brief on an empty database, without crashing", () => {
    // Picked well away from month end so the empty-config colchon default
    // (unfunded) never trips colchon_no_financiado here.
    expect(() => buildDailyBrief(db, { date: TARGET_DAY, now: NOW_MIDDAY })).not.toThrow();

    const brief = buildDailyBrief(db, { date: TARGET_DAY, now: NOW_MIDDAY });

    expect(brief.totalGastado).toBe(0);
    expect(brief.topConsumos).toEqual([]);
    expect(brief.vsPromedio).toEqual({ dia: 0, promedio: 0, diferencia: 0 });
    expect(brief.alertas).toEqual([]);
    expect(brief.recordatorioTarjeta).toBe(false);
  });
});
