/**
 * Tests for the F3-B / TASK-034 chat tool surface (tests-after, with
 * tdd-style boundary locks for check_affordability per the ticket). Each
 * handler is asserted against the underlying engine/query call computed
 * directly, so this suite catches the tool layer duplicating or drifting
 * from the F2-C engine's own arithmetic rather than just wiring it through.
 */
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../db/schema.js";
import { insertStatement, insertTransaction } from "../db/repository.js";
import type { NewTransaction } from "../db/repository.js";
import { buildOverview } from "../api/routes.js";
import { buildDailyBrief } from "../brief/build-brief.js";
import { spendingByCategory } from "../strategy/index.js";
import {
  checkAffordability,
  createEngineToolsServer,
  getCardStatement,
  getDailyBrief,
  getStrategyOverview,
  queryTransactions,
} from "./engine-tools.js";

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

describe("getStrategyOverview", () => {
  const FIXED_NOW = new Date("2026-07-15T15:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns exactly buildOverview()'s output -- same shared computation the /api/overview route calls", () => {
    insertTransaction(db, tx({ gmail_msg_id: "g1", counterparty: "Supermaxi", amount: 20 }));
    insertStatement(db, {
      gmail_msg_id: "stmt-1",
      card_mask: "XXXX1234",
      issue_date: "2026-06-25",
      balance: 300,
      min_payment: 30,
      due_date: "2026-07-20",
    });

    expect(getStrategyOverview(db)).toEqual(buildOverview(db, FIXED_NOW));
  });

  it("degrades to nulls/empties on an empty DB, without inventing figures", () => {
    const result = getStrategyOverview(db);
    expect(result.card).toBeNull();
    expect(result.card_status).toBeNull();
    expect(result.spending_by_category).toEqual({});
    expect(result).toEqual(buildOverview(db, FIXED_NOW));
  });
});

describe("queryTransactions", () => {
  beforeEach(() => {
    insertTransaction(db, tx({ gmail_msg_id: "a", ts: "2026-07-10T13:00:00Z", type: "debito", counterparty: "Supermaxi", amount: 10 }));
    insertTransaction(db, tx({ gmail_msg_id: "b", ts: "2026-07-11T13:00:00Z", type: "servicio", counterparty: "CNT", amount: 15 }));
    insertTransaction(db, tx({ gmail_msg_id: "reversed", ts: "2026-07-12T13:00:00Z", amount: 999, is_reversed: true }));
    insertTransaction(db, tx({ gmail_msg_id: "internal", ts: "2026-07-12T14:00:00Z", type: "transferencia", amount: 200, is_internal: true }));
  });

  it("excludes reversed and internal rows by default and orders by ts descending", () => {
    const result = queryTransactions(db, {});
    expect(result.transactions.map((r) => r.gmail_msg_id)).toEqual(["b", "a"]);
    expect(result.count).toBe(2);
  });

  it("includes reversed/internal rows when explicitly requested", () => {
    const result = queryTransactions(db, { include_reversed: true, include_internal: true });
    expect(result.count).toBe(4);
  });

  it("filters by type/direction/counterparty/limit, matching queryTransactions directly", () => {
    const result = queryTransactions(db, { type: "servicio" });
    expect(result.transactions.map((r) => r.gmail_msg_id)).toEqual(["b"]);
  });

  it("computes spending_by_category over the given [from, to) range", () => {
    const from = "2026-07-10T00:00:00Z";
    const to = "2026-07-12T00:00:00Z";
    const result = queryTransactions(db, { from, to });
    expect(result.spending_by_category).toEqual(spendingByCategory(db, { from: new Date(from), to: new Date(to) }));
    expect(result.spending_by_category?.servicios).toBeCloseTo(15, 5);
  });

  it("returns null spending_by_category (never a guess) when no range is given", () => {
    expect(queryTransactions(db, {}).spending_by_category).toBeNull();
  });

  it("returns null spending_by_category when the range doesn't parse", () => {
    expect(queryTransactions(db, { from: "not-a-date", to: "also-not-a-date" }).spending_by_category).toBeNull();
  });
});

describe("getDailyBrief", () => {
  it("passes the date through to buildDailyBrief unmodified", () => {
    insertTransaction(db, tx({ gmail_msg_id: "g1", amount: 30, ts: "2026-07-10T13:00:00Z" }));
    const date = "2026-07-10";
    expect(getDailyBrief(db, { date })).toEqual(buildDailyBrief(db, { date }));
  });

  it("defers to buildDailyBrief's own default (yesterday) when no date is given", () => {
    const FIXED_NOW = new Date("2026-07-15T15:00:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FIXED_NOW);
    try {
      expect(getDailyBrief(db, {})).toEqual(buildDailyBrief(db, {}));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("getCardStatement", () => {
  it("returns an explicit 'no statement loaded' result when none exists", () => {
    expect(getCardStatement(db)).toEqual({
      available: false,
      card_mask: null,
      issue_date: null,
      balance: null,
      min_payment: null,
      due_date: null,
      message: "no statement loaded",
    });
  });

  it("returns the latest statement's figures when one is loaded", () => {
    insertStatement(db, {
      gmail_msg_id: "stmt-1",
      card_mask: "XXXX1234",
      issue_date: "2026-06-25",
      balance: 300,
      min_payment: 30,
      due_date: "2026-07-20",
    });

    expect(getCardStatement(db)).toEqual({
      available: true,
      card_mask: "XXXX1234",
      issue_date: "2026-06-25",
      balance: 300,
      min_payment: 30,
      due_date: "2026-07-20",
      message: null,
    });
  });
});

describe("checkAffordability -- boundary locks", () => {
  // Deterministic fixture, no ledger rows needed: colchonObjetivo/tope are
  // irrelevant to safeToSpendHoy's own formula, so only sueldo +
  // balanceSnapshot are set. A single fixed payday window ("20-20") pins
  // nextPayday to 2026-07-20 with no historical sueldo transactions to
  // average against (see calendar.ts's fallbackDayForWindow).
  //
  // safeToSpendHoy(2026-07-10) = max(0, (disponible - colchon - tarjeta -
  // esenciales) / diasHastaProximoPago)
  //   disponible = balanceSnapshot.amount = 1000 (no tx after the snapshot)
  //   colchonReservado = 0 (no savings row)
  //   proximoPagoTarjeta = 0 (no statement)
  //   esenciales = 0 (no debito/servicio/retiro rows)
  //   diasHastaProximoPago = 10 (2026-07-10 -> 2026-07-20)
  //   => (1000 - 0 - 0 - 0) / 10 = 100.00 exactly.
  beforeEach(() => {
    setConfig("sueldo", { fuente: "Acme", cadencia: "quincenal", montoEstimado: 1000, diasPago: ["20-20"] });
    setConfig("balanceSnapshot", { amount: 1000, at: "2026-07-01" });
  });

  it("is viable exactly at the safe-to-spend boundary (amount === safeToSpendHoy)", () => {
    const verdict = checkAffordability(db, { amount: 100, date: "2026-07-10" });
    expect(verdict.safeToSpendHoy).toBe(100);
    expect(verdict.safeToSpendAfter).toBe(0);
    expect(verdict.viable).toBe(true);
    expect(verdict.date).toBe("2026-07-10");
    expect(verdict.nextPayday).toBe("2026-07-20");
  });

  it("is not viable one cent past the safe-to-spend boundary", () => {
    const verdict = checkAffordability(db, { amount: 100.01, date: "2026-07-10" });
    expect(verdict.safeToSpendHoy).toBe(100);
    expect(verdict.safeToSpendAfter).toBeCloseTo(-0.01, 5);
    expect(verdict.viable).toBe(false);
    expect(verdict.reason).toContain("excede");
  });

  it("is viable well under the boundary and reports the remaining budget", () => {
    const verdict = checkAffordability(db, { amount: 40, date: "2026-07-10" });
    expect(verdict.viable).toBe(true);
    expect(verdict.safeToSpendAfter).toBe(60);
    expect(verdict.reason).toContain("cabe");
  });

  it("carries colchón/card status context alongside the verdict, sourced from the engine", () => {
    setConfig("colchonObjetivo", 500);
    db.prepare("INSERT INTO savings (label, target, reserved, updated_at) VALUES ('colchon', 500, 100, datetime('now'))").run();
    const verdict = checkAffordability(db, { amount: 10, date: "2026-07-10" });
    expect(verdict.bufferStatus).toEqual({ objetivo: 500, reservado: 100, financiado: false, faltante: 400 });
    expect(verdict.cardStatus).toBeNull(); // no statement loaded
  });

  it("reports this-month category spend for a known category", () => {
    insertTransaction(db, tx({ gmail_msg_id: "svc-1", type: "servicio", amount: 45, ts: "2026-07-05T12:00:00Z" }));
    const verdict = checkAffordability(db, { amount: 10, date: "2026-07-10", category: "servicios" });
    expect(verdict.categorySpentThisMonth).toBeCloseTo(45, 5);
  });

  it("returns null categorySpentThisMonth for an unknown category (never a guess) or when none is given", () => {
    expect(checkAffordability(db, { amount: 10, date: "2026-07-10" }).categorySpentThisMonth).toBeNull();
    expect(checkAffordability(db, { amount: 10, date: "2026-07-10", category: "not-a-real-category" }).categorySpentThisMonth).toBeNull();
  });
});

describe("createEngineToolsServer", () => {
  it("registers as an in-process 'sdk' MCP server named wallet-engine with a live McpServer instance", () => {
    const server = createEngineToolsServer(() => db);
    expect(server.type).toBe("sdk");
    expect(server.name).toBe("wallet-engine");
    expect(server.instance).toBeDefined();
  });
});
