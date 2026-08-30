import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../index.js";
import { migrate } from "../db/schema.js";
import { insertStatement, insertTransaction } from "../db/repository.js";
import type { NewTransaction } from "../db/repository.js";

let db: Database.Database;
let app: ReturnType<typeof createApp>;

function baseTx(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    gmail_msg_id: "msg-1",
    ts: "2026-07-01T12:00:00Z",
    direction: "out",
    type: "debito",
    amount: 25.5,
    counterparty: "Supermaxi",
    ...overrides,
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  app = createApp(db);
});

describe("GET /api/transactions", () => {
  beforeEach(() => {
    insertTransaction(db, baseTx({ gmail_msg_id: "a", ts: "2026-07-01T00:00:00Z", type: "debito", direction: "out", counterparty: "Supermaxi", amount: 10 }));
    insertTransaction(db, baseTx({ gmail_msg_id: "b", ts: "2026-07-05T00:00:00Z", type: "sueldo", direction: "in", counterparty: "Employer", amount: 500 }));
    insertTransaction(db, baseTx({ gmail_msg_id: "c", ts: "2026-07-10T00:00:00Z", type: "debito", direction: "out", counterparty: "Amazon", amount: 30, is_reversed: true }));
    insertTransaction(db, baseTx({ gmail_msg_id: "d", ts: "2026-07-12T00:00:00Z", type: "transferencia", direction: "out", counterparty: "Ahorros", amount: 40, is_internal: true }));
  });

  it("returns transactions ordered by ts descending, excluding reversed/internal by default", () => {
    return request(app)
      .get("/api/transactions")
      .expect(200)
      .then((res) => {
        expect(res.body.transactions.map((t: any) => t.gmail_msg_id)).toEqual(["b", "a"]);
        expect(res.body.count).toBe(2);
      });
  });

  it("filters by date range", () => {
    return request(app)
      .get("/api/transactions")
      .query({ from: "2026-07-02T00:00:00Z", to: "2026-07-06T00:00:00Z" })
      .expect(200)
      .then((res) => {
        expect(res.body.transactions.map((t: any) => t.gmail_msg_id)).toEqual(["b"]);
      });
  });

  it("filters by type and direction", () => {
    return request(app)
      .get("/api/transactions")
      .query({ type: "sueldo", direction: "in" })
      .expect(200)
      .then((res) => {
        expect(res.body.transactions.map((t: any) => t.gmail_msg_id)).toEqual(["b"]);
      });
  });

  it("filters by counterparty", () => {
    return request(app)
      .get("/api/transactions")
      .query({ counterparty: "Supermaxi" })
      .expect(200)
      .then((res) => {
        expect(res.body.transactions.map((t: any) => t.gmail_msg_id)).toEqual(["a"]);
      });
  });

  it("includes reversed rows, marked, when include_reversed=true", () => {
    return request(app)
      .get("/api/transactions")
      .query({ include_reversed: "true" })
      .expect(200)
      .then((res) => {
        const ids = res.body.transactions.map((t: any) => t.gmail_msg_id);
        expect(ids).toContain("c");
        const reversedRow = res.body.transactions.find((t: any) => t.gmail_msg_id === "c");
        expect(reversedRow.is_reversed).toBe(1);
      });
  });

  it("includes internal rows, marked, when include_internal=true", () => {
    return request(app)
      .get("/api/transactions")
      .query({ include_internal: "true" })
      .expect(200)
      .then((res) => {
        const ids = res.body.transactions.map((t: any) => t.gmail_msg_id);
        expect(ids).toContain("d");
        const internalRow = res.body.transactions.find((t: any) => t.gmail_msg_id === "d");
        expect(internalRow.is_internal).toBe(1);
      });
  });

  it("respects limit and offset", () => {
    return request(app)
      .get("/api/transactions")
      .query({ limit: 1, offset: 1 })
      .expect(200)
      .then((res) => {
        expect(res.body.transactions).toHaveLength(1);
        expect(res.body.transactions[0].gmail_msg_id).toBe("a");
      });
  });

  it("400s on an invalid type value", () => {
    return request(app)
      .get("/api/transactions")
      .query({ type: "not-a-real-type" })
      .expect(400)
      .then((res) => {
        expect(res.body.error).toBeDefined();
      });
  });

  it("400s on a malformed date", () => {
    return request(app)
      .get("/api/transactions")
      .query({ from: "not-a-date" })
      .expect(400);
  });

  it("400s on a non-numeric limit", () => {
    return request(app).get("/api/transactions").query({ limit: "abc" }).expect(400);
  });

  it("400s on an out-of-range limit instead of silently clamping", () => {
    return request(app).get("/api/transactions").query({ limit: "9999" }).expect(400);
  });
});

describe("GET /api/review", () => {
  beforeEach(() => {
    insertTransaction(db, baseTx({ gmail_msg_id: "clean", ts: "2026-07-01T00:00:00Z", needs_review: false }));
    insertTransaction(db, baseTx({ gmail_msg_id: "flagged-1", ts: "2026-07-03T00:00:00Z", needs_review: true }));
    insertTransaction(db, baseTx({ gmail_msg_id: "flagged-2", ts: "2026-07-02T00:00:00Z", needs_review: true }));
  });

  it("returns only needs_review=true transactions, most recent first", () => {
    return request(app)
      .get("/api/review")
      .expect(200)
      .then((res) => {
        expect(res.body.transactions.map((t: any) => t.gmail_msg_id)).toEqual(["flagged-1", "flagged-2"]);
        expect(res.body.count).toBe(2);
        for (const tx of res.body.transactions) {
          expect(tx.needs_review).toBe(1);
        }
      });
  });

  it("returns an empty list when nothing needs review", () => {
    db.exec("DELETE FROM transactions");
    return request(app)
      .get("/api/review")
      .expect(200)
      .then((res) => {
        expect(res.body.transactions).toEqual([]);
        expect(res.body.count).toBe(0);
      });
  });
});

// La salida de la cola: hasta este endpoint, `/api/review` era una lista de
// solo lectura sobre filas que nada podia desmarcar. Ver review/resolve.ts.
describe("POST /api/review/:id/resolve", () => {
  function enRevision(overrides: Partial<NewTransaction> = {}): number {
    return insertTransaction(db, baseTx({ gmail_msg_id: "flagged", needs_review: true, ...overrides })).row.id;
  }

  it("confirma la fila: sale de la cola y devuelve la transaccion y la auditoria", () => {
    const id = enRevision({ amount: 12.5 });
    return request(app)
      .post(`/api/review/${id}/resolve`)
      .send({ action: "confirm", resolved_by: "mato" })
      .expect(200)
      .then(async (res) => {
        expect(res.body.changed).toBe(true);
        expect(res.body.transaction.needs_review).toBe(0);
        expect(res.body.transaction.amount).toBe(12.5);
        expect(res.body.resolution).toMatchObject({ action: "confirm", resolved_by: "mato" });
        const review = await request(app).get("/api/review").expect(200);
        expect(review.body.count).toBe(0);
      });
  });

  it("corrige el monto cuando lo afirma un humano", () => {
    const id = enRevision({ amount: null });
    return request(app)
      .post(`/api/review/${id}/resolve`)
      .send({ action: "correct", amount: 41.07, resolved_by: "mato", note: "leido del correo" })
      .expect(200)
      .then((res) => {
        expect(res.body.transaction.amount).toBe(41.07);
        expect(res.body.transaction.source).toBe("human");
      });
  });

  it("descarta la fila sin devolverla a los totales", () => {
    const id = enRevision({ amount: 12.5 });
    return request(app)
      .post(`/api/review/${id}/resolve`)
      .send({ action: "discard", resolved_by: "mato" })
      .expect(200)
      .then((res) => {
        expect(res.body.transaction.is_discarded).toBe(1);
      });
  });

  it("es idempotente: la segunda llamada responde changed:false", async () => {
    const id = enRevision({ amount: 12.5 });
    await request(app).post(`/api/review/${id}/resolve`).send({ action: "confirm", resolved_by: "mato" }).expect(200);
    const second = await request(app)
      .post(`/api/review/${id}/resolve`)
      .send({ action: "confirm", resolved_by: "mato" })
      .expect(200);
    expect(second.body).toMatchObject({ changed: false, reason: "already_resolved" });
  });

  it("404 cuando la fila no existe", () => {
    return request(app)
      .post("/api/review/9999/resolve")
      .send({ action: "confirm", resolved_by: "mato" })
      .expect(404)
      .then((res) => expect(res.body.error).toBe("not_found"));
  });

  it.each([
    ["accion desconocida", { action: "borrar", resolved_by: "mato" }],
    ["correct sin monto", { action: "correct", resolved_by: "mato" }],
    ["confirm con monto", { action: "confirm", amount: 9, resolved_by: "mato" }],
    ["monto negativo", { action: "correct", amount: -1, resolved_by: "mato" }],
    ["id no numerico", null],
  ])("400 en %s", (_caso, body) => {
    const id = enRevision({ amount: 12.5 });
    const url = body === null ? "/api/review/abc/resolve" : `/api/review/${id}/resolve`;
    return request(app)
      .post(url)
      .send(body ?? { action: "confirm", resolved_by: "mato" })
      .expect(400);
  });

  it("una fila descartada desaparece de /api/transactions salvo que se la pida", async () => {
    const id = enRevision({ gmail_msg_id: "descartada", amount: 12.5 });
    await request(app).post(`/api/review/${id}/resolve`).send({ action: "discard", resolved_by: "mato" }).expect(200);

    const listado = await request(app).get("/api/transactions").expect(200);
    expect(listado.body.transactions.map((t: any) => t.gmail_msg_id)).not.toContain("descartada");

    const conDescartadas = await request(app).get("/api/transactions?include_discarded=true").expect(200);
    expect(conDescartadas.body.transactions.map((t: any) => t.gmail_msg_id)).toContain("descartada");
  });

  it("registra la resolucion en el historial consultable", async () => {
    const id = enRevision({ amount: 12.5 });
    await request(app).post(`/api/review/${id}/resolve`).send({ action: "confirm", resolved_by: "mato" }).expect(200);

    const history = await request(app).get("/api/review/resolutions").expect(200);
    expect(history.body.count).toBe(1);
    expect(history.body.resolutions[0]).toMatchObject({ transaction_id: id, action: "confirm", resolved_by: "mato" });
  });
});

describe("GET /api/overview", () => {
  it("returns null balance and null card when nothing is seeded yet, without inventing figures", () => {
    return request(app)
      .get("/api/overview")
      .expect(200)
      .then((res) => {
        expect(res.body.balance).toBeNull();
        expect(res.body.card).toBeNull();
        expect(res.body.counts).toEqual({ total: 0, needs_review: 0 });
      });
  });

  it("surfaces the latest statement's balance/min/due and accurate counts", () => {
    insertStatement(db, {
      gmail_msg_id: "stmt-old",
      card_mask: "XXXXXX20924",
      issue_date: "2026-06-01",
      balance: 200,
      min_payment: 20,
      due_date: "2026-06-25",
    });
    insertStatement(db, {
      gmail_msg_id: "stmt-new",
      card_mask: "XXXXXX20924",
      issue_date: "2026-07-01",
      balance: 350.75,
      min_payment: 35,
      due_date: "2026-07-25",
    });
    insertTransaction(db, baseTx({ gmail_msg_id: "a" }));
    insertTransaction(db, baseTx({ gmail_msg_id: "b", needs_review: true }));

    return request(app)
      .get("/api/overview")
      .expect(200)
      .then((res) => {
        expect(res.body.card).toEqual({
          card_mask: "XXXXXX20924",
          issue_date: "2026-07-01",
          balance: 350.75,
          min_payment: 35,
          due_date: "2026-07-25",
        });
        expect(res.body.counts).toEqual({ total: 2, needs_review: 1 });
      });
  });

  it("surfaces the balance snapshot from strategy_config when present", () => {
    db.prepare("INSERT INTO strategy_config (key, value) VALUES ('balanceSnapshot', ?)").run(
      JSON.stringify({ amount: 2409, at: "2026-07-20" })
    );

    return request(app)
      .get("/api/overview")
      .expect(200)
      .then((res) => {
        expect(res.body.balance).toEqual({ amount: 2409, currency: "USD", at: "2026-07-20" });
      });
  });
});

describe("unknown /api/* routes", () => {
  it("returns JSON 404, not the SPA catch-all", () => {
    return request(app)
      .get("/api/does-not-exist")
      .expect(404)
      .expect("Content-Type", /json/)
      .then((res) => {
        expect(res.body.error).toBeDefined();
      });
  });
});
