/**
 * Integration tests for the STRATEGY API (F2-D / TASK-026, tests-after):
 * the extended GET /api/overview, GET /api/transfers, GET
 * /api/strategy/projection, POST /api/debts/:id/paid, and POST
 * /api/buffer. Seeds a fixture DB (config + transactions incl. a
 * reversed/internal/needs_review row to confirm the strategy engine's
 * shared exclusions apply end-to-end + a statement + savings + debts) and
 * asserts against the same F2-C engine functions computed directly, so the
 * route layer is checked for faithfully wiring the engine rather than
 * duplicating its arithmetic.
 */
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../index.js";
import { migrate } from "../db/schema.js";
import { insertStatement, insertTransaction } from "../db/repository.js";
import type { NewTransaction } from "../db/repository.js";
import { colchonStatus, nextPayday, proyeccionSinDeuda, safeToSpendHoy, tarjetaStatus, transferenciasMes } from "../strategy/index.js";

// Fixed "now" (local July 1, 2026, 10:00) so the engine calls this
// suite makes directly line up exactly with what the route's own
// `new Date()` sees.
const FIXED_NOW = new Date("2026-07-01T15:00:00.000Z");

let db: Database.Database;
let app: ReturnType<typeof createApp>;

function baseTx(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    gmail_msg_id: "msg",
    ts: "2026-07-02T12:00:00Z",
    direction: "out",
    type: "debito",
    amount: 10,
    counterparty: "Supermaxi",
    ...overrides,
  };
}

function setConfig(db: Database.Database, key: string, value: unknown): void {
  db.prepare("INSERT INTO strategy_config (key, value) VALUES (@key, @value)").run({
    key,
    value: JSON.stringify(value),
  });
}

function seedConfig(db: Database.Database): void {
  setConfig(db, "colchonObjetivo", 1000);
  setConfig(db, "topeTransferenciasMensual", 500);
  setConfig(db, "sueldo", { fuente: "Acme Corp S.A.", cadencia: "quincenal", montoEstimado: 2000, diasPago: ["<=5", "18-20"] });
  setConfig(db, "balanceSnapshot", { amount: 1000, at: "2026-06-30" });
}

function seedLedger(db: Database.Database): void {
  insertTransaction(db, baseTx({ gmail_msg_id: "gasto-1", ts: "2026-07-02T12:00:00Z", type: "debito", amount: 20, counterparty: "Supermaxi" }));
  insertTransaction(db, baseTx({ gmail_msg_id: "gasto-2", ts: "2026-07-03T12:00:00Z", type: "servicio", amount: 30, counterparty: "CNT" }));
  insertTransaction(db, baseTx({ gmail_msg_id: "xfer-1", ts: "2026-07-04T12:00:00Z", type: "transferencia", amount: 100, counterparty: "Juan Perez" }));
  insertTransaction(db, baseTx({ gmail_msg_id: "xfer-2", ts: "2026-07-05T13:00:00Z", type: "transferencia", amount: 50, counterparty: "Maria Lopez" }));
  insertTransaction(db, baseTx({ gmail_msg_id: "reversed", ts: "2026-07-06T12:00:00Z", type: "debito", amount: 999, is_reversed: true }));
  insertTransaction(db, baseTx({ gmail_msg_id: "internal", ts: "2026-07-07T12:00:00Z", type: "transferencia", amount: 200, is_internal: true }));
  insertTransaction(db, baseTx({ gmail_msg_id: "flagged", ts: "2026-07-08T12:00:00Z", type: "debito", amount: 40, needs_review: true }));
  insertTransaction(db, baseTx({ gmail_msg_id: "sueldo-1", ts: "2026-07-05T09:00:00Z", type: "sueldo", direction: "in", amount: 2000, counterparty: "Employer" }));

  insertStatement(db, {
    gmail_msg_id: "stmt-1",
    card_mask: "XXXX1234",
    issue_date: "2026-06-25",
    balance: 300,
    min_payment: 30,
    due_date: "2026-07-20",
  });

  db.prepare("INSERT INTO savings (label, target, reserved, updated_at) VALUES ('colchon', 1000, 200, datetime('now'))").run();

  db.prepare("INSERT INTO debts (person, amount, kind, status) VALUES (@person, @amount, 'personal', 'pending')").run({
    person: "Debt A",
    amount: 50,
  });
  db.prepare("INSERT INTO debts (person, amount, kind, status) VALUES (@person, @amount, 'personal', 'pending')").run({
    person: "Debt B",
    amount: 30,
  });
}

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  app = createApp(db);
  // Fake only Date (not timers) -- supertest's underlying HTTP server relies
  // on real setTimeout/setInterval, which faking those too would break.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/overview (strategy indicators)", () => {
  it("keeps the F1-09 fields and adds the strategy indicators, matching the engine directly", () => {
    seedConfig(db);
    seedLedger(db);

    return request(app)
      .get("/api/overview")
      .expect(200)
      .then((res) => {
        // F1-09 fields untouched.
        expect(res.body.card).toEqual({
          card_mask: "XXXX1234",
          issue_date: "2026-06-25",
          balance: 300,
          min_payment: 30,
          due_date: "2026-07-20",
        });
        expect(res.body.counts).toEqual({ total: 8, needs_review: 1 });

        // Strategy indicators sourced straight from the engine.
        expect(res.body.safe_to_spend_hoy).toBe(safeToSpendHoy(db, FIXED_NOW));
        expect(res.body.buffer_status).toEqual(colchonStatus(db));
        expect(res.body.card_status).toEqual(tarjetaStatus(db, FIXED_NOW));
        expect(res.body.transfers_summary).toEqual(transferenciasMes(db, FIXED_NOW));
        expect(res.body.next_payday).toBe(nextPayday(db, FIXED_NOW));

        // Reversed/internal/needs_review rows never inflate the buckets, and
        // income never lands in spending_by_category (direction='out' only).
        expect(res.body.spending_by_category.otros).toBeCloseTo(20, 5); // Supermaxi debito, no establishment match
        expect(res.body.spending_by_category.servicios).toBeCloseTo(30, 5);
        expect(res.body.spending_by_category.transferencia_persona).toBeCloseTo(150, 5);
        expect(Object.values(res.body.spending_by_category as Record<string, number>).reduce((a, b) => a + b, 0)).toBeCloseTo(
          200,
          5
        );

        expect(res.body.buffer_status).toEqual({ objetivo: 1000, reservado: 200, financiado: false, faltante: 800, fijado: true });
      });
  });

  it("degrades to nulls/empties without inventing figures on an empty DB", () => {
    // No statement, no ledger rows -- card_status and spending_by_category
    // have nothing to report. strategy_config itself falls back to its
    // documented defaults (F2-A), so safe_to_spend_hoy is still computed
    // from those, not zeroed out.
    return request(app)
      .get("/api/overview")
      .expect(200)
      .then((res) => {
        expect(res.body.card_status).toBeNull();
        expect(res.body.spending_by_category).toEqual({});
        expect(res.body.safe_to_spend_hoy).toBe(safeToSpendHoy(db, FIXED_NOW));
        expect(res.body.transfers_summary.topContrapartes).toEqual([]);
      });
  });
});

describe("GET /api/transfers", () => {
  it("returns transferenciasMes() verbatim", () => {
    seedConfig(db);
    seedLedger(db);

    return request(app)
      .get("/api/transfers")
      .expect(200)
      .then((res) => {
        expect(res.body).toEqual(transferenciasMes(db, FIXED_NOW));
        expect(res.body.total).toBe(150);
        expect(res.body.sobrepasado).toBe(false);
        expect(res.body.topContrapartes[0]).toEqual({ counterparty: "Juan Perez", total: 100 });
      });
  });
});

describe("GET /api/strategy/projection", () => {
  it("returns {meses: null, fechaEstimada: null} when there is debt but no abono", () => {
    seedConfig(db);
    seedLedger(db);

    return request(app)
      .get("/api/strategy/projection")
      .expect(200)
      .then((res) => {
        expect(res.body).toEqual(proyeccionSinDeuda(db, undefined, FIXED_NOW));
        expect(res.body).toEqual({ meses: null, fechaEstimada: null });
      });
  });

  it("projects months/date to zero debt given ?abono=", () => {
    seedConfig(db);
    seedLedger(db);

    return request(app)
      .get("/api/strategy/projection")
      .query({ abono: 100 })
      .expect(200)
      .then((res) => {
        expect(res.body).toEqual(proyeccionSinDeuda(db, 100, FIXED_NOW));
        // saldoCorte 300 + pending debts 80 = 380, /100 -> 4 months.
        expect(res.body.meses).toBe(4);
      });
  });

  it("400s on a negative abono", () => {
    return request(app).get("/api/strategy/projection").query({ abono: -5 }).expect(400);
  });

  it("400s on a non-numeric abono", () => {
    return request(app).get("/api/strategy/projection").query({ abono: "lots" }).expect(400);
  });
});

describe("POST /api/debts/:id/paid", () => {
  it("marks a pending debt paid and is idempotent on a second call", () => {
    seedConfig(db);
    seedLedger(db);
    const { id } = db.prepare("SELECT id FROM debts WHERE person = 'Debt B'").get() as { id: number };

    return request(app)
      .post(`/api/debts/${id}/paid`)
      .expect(200)
      .then((res) => {
        expect(res.body.debt.status).toBe("paid");
        expect(res.body.debt.id).toBe(id);

        return request(app)
          .post(`/api/debts/${id}/paid`)
          .expect(200)
          .then((res2) => {
            expect(res2.body.debt.status).toBe("paid");
          });
      });
  });

  it("404s on an unknown debt id", () => {
    return request(app).post("/api/debts/999999/paid").expect(404);
  });

  it("400s on a non-numeric id", () => {
    return request(app).post("/api/debts/abc/paid").expect(400);
  });
});

describe("POST /api/buffer", () => {
  it("updates the 'colchon' reserved amount when a row already exists", () => {
    seedConfig(db);
    seedLedger(db);

    return request(app)
      .post("/api/buffer")
      .send({ reserved: 500 })
      .expect(200)
      .then((res) => {
        expect(res.body.savings.reserved).toBe(500);
        expect(res.body.savings.label).toBe("colchon");

        return request(app)
          .get("/api/overview")
          .expect(200)
          .then((res2) => {
            expect(res2.body.buffer_status).toEqual({ objetivo: 1000, reservado: 500, financiado: false, faltante: 500, fijado: true });
          });
      });
  });

  it("inserts a fresh 'colchon' row when none exists yet", () => {
    return request(app)
      .post("/api/buffer")
      .send({ reserved: 250 })
      .expect(200)
      .then((res) => {
        expect(res.body.savings.reserved).toBe(250);
        expect(res.body.savings.target).toBeNull();
      });
  });

  it("400s on a negative reserved amount", () => {
    return request(app).post("/api/buffer").send({ reserved: -1 }).expect(400);
  });

  it("400s when reserved is missing or not a number", () => {
    return request(app).post("/api/buffer").send({}).expect(400);
  });
});
