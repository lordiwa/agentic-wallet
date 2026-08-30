import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { insertTransaction, type NewTransaction, type TransactionRow } from "../db/repository.js";
import { queryReviewTransactions } from "../api/queries.js";
import { seedFixture } from "../seed/seed.fixture.js";
import { balanceActual } from "../strategy/balance.js";
import { listReviewResolutions, resolveReview } from "./resolve.js";

let db: Database.Database;

const NOW = new Date("2026-08-30T12:00:00Z");

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

/**
 * Una fila en la cola de revision. Por defecto es el caso mas comun —el parser
 * no pudo leer el monto, asi que quedo con el placeholder y `needs_review = 1`
 * (ver db/repository.ts)— pero `needs_review` va explicito porque el otro caso
 * real es una fila CON monto marcada por otro motivo (reverso ambiguo), y
 * pasarle un `amount` a este helper no tiene que sacarla de la cola.
 */
function enRevision(overrides: Partial<NewTransaction> = {}): TransactionRow {
  return insertTransaction(db, {
    gmail_msg_id: "msg-en-revision",
    ts: "2026-07-22T12:00:00Z",
    direction: "out",
    type: "debito",
    amount: null,
    needs_review: true,
    counterparty: "COMERCIO EJEMPLO",
    raw_subject: "Consumo tarjeta de débito",
    ...overrides,
  }).row;
}

describe("resolveReview: confirmar", () => {
  it("saca la fila de la cola y la deja entrar a los totales", () => {
    const row = enRevision({ amount: 12.5 });
    expect(queryReviewTransactions(db)).toHaveLength(1);

    const result = resolveReview(db, { id: row.id, action: "confirm", resolvedBy: "tester" }, { now: NOW });

    expect(result.ok).toBe(true);
    expect(result.ok && result.changed).toBe(true);
    expect(result.ok && result.transaction.needs_review).toBe(0);
    expect(queryReviewTransactions(db)).toHaveLength(0);
  });

  it("no toca el monto del parser", () => {
    const row = enRevision({ amount: 12.5 });

    const result = resolveReview(db, { id: row.id, action: "confirm", resolvedBy: "tester" }, { now: NOW });

    expect(result.ok && result.transaction.amount).toBe(12.5);
    expect(result.ok && result.transaction.source).toBe(row.source);
  });

  // La regla de oro: el monto sale del parser. Aceptar un `amount` en
  // `confirm` y descartarlo en silencio seria peor que rechazarlo — el humano
  // creeria que corrigio algo que nunca se escribio.
  it.each(["confirm", "discard"] as const)("rechaza un monto en la accion %s en vez de ignorarlo", (action) => {
    const row = enRevision({ amount: 12.5 });

    const result = resolveReview(db, { id: row.id, action, amount: 99, resolvedBy: "tester" }, { now: NOW });

    expect(result).toEqual({ ok: false, error: "amount_not_allowed" });
    expect(queryReviewTransactions(db)).toHaveLength(1);
  });
});

describe("resolveReview: corregir", () => {
  it("escribe el monto que afirma el humano y saca la fila de la cola", () => {
    const row = enRevision(); // amount: null -> placeholder 0 + needs_review

    const result = resolveReview(
      db,
      { id: row.id, action: "correct", amount: 41.07, resolvedBy: "mato", note: "leido del correo" },
      { now: NOW }
    );

    expect(result.ok && result.transaction.amount).toBe(41.07);
    expect(result.ok && result.transaction.needs_review).toBe(0);
  });

  // Que el monto lo puso una persona y no el parser tiene que quedar visible en
  // la fila, no solo en la auditoria: `source` deja de ser una afirmacion sobre
  // como lo leyo el motor.
  it("marca la fila como source 'human'", () => {
    const row = enRevision();

    const result = resolveReview(db, { id: row.id, action: "correct", amount: 41.07, resolvedBy: "mato" }, { now: NOW });

    expect(result.ok && result.transaction.source).toBe("human");
  });

  it("acepta 0 como monto valido (cero no es 'no pude leerlo')", () => {
    const row = enRevision({ amount: 55 });

    const result = resolveReview(db, { id: row.id, action: "correct", amount: 0, resolvedBy: "mato" }, { now: NOW });

    expect(result.ok && result.transaction.amount).toBe(0);
    expect(result.ok && result.transaction.needs_review).toBe(0);
  });

  it("exige el monto y no escribe nada si falta", () => {
    const row = enRevision();

    const result = resolveReview(db, { id: row.id, action: "correct", resolvedBy: "mato" }, { now: NOW });

    expect(result).toEqual({ ok: false, error: "amount_required" });
    expect(queryReviewTransactions(db)).toHaveLength(1);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])("rechaza el monto invalido %j", (amount) => {
    const row = enRevision();

    const result = resolveReview(db, { id: row.id, action: "correct", amount, resolvedBy: "mato" }, { now: NOW });

    expect(result).toEqual({ ok: false, error: "invalid_amount" });
    expect(queryReviewTransactions(db)).toHaveLength(1);
  });
});

describe("resolveReview: descartar", () => {
  it("saca la fila de la cola pero NO la deja entrar a los totales", () => {
    seedFixture(db); // balanceSnapshot: { amount: 2409, at: "2026-07-20" }
    const row = enRevision({ gmail_msg_id: "msg-descartado", direction: "in", type: "recibido", amount: 500 });

    const result = resolveReview(db, { id: row.id, action: "discard", resolvedBy: "mato" }, { now: NOW });

    expect(result.ok && result.transaction.needs_review).toBe(0);
    expect(result.ok && result.transaction.is_discarded).toBe(1);
    expect(queryReviewTransactions(db)).toHaveLength(0);
    expect(balanceActual(db, new Date("2026-07-25T12:00:00Z"))).toBe(2409);
  });

  it("una fila confirmada SI entra a los totales (el contraste con descartar)", () => {
    seedFixture(db);
    const row = enRevision({ gmail_msg_id: "msg-confirmado", direction: "in", type: "recibido", amount: 500 });

    resolveReview(db, { id: row.id, action: "confirm", resolvedBy: "mato" }, { now: NOW });

    expect(balanceActual(db, new Date("2026-07-25T12:00:00Z"))).toBe(2409 + 500);
  });
});

describe("resolveReview: idempotencia y bordes", () => {
  it("la segunda llamada no cambia nada ni duplica la auditoria", () => {
    const row = enRevision({ amount: 12.5 });

    const first = resolveReview(db, { id: row.id, action: "confirm", resolvedBy: "mato" }, { now: NOW });
    const second = resolveReview(db, { id: row.id, action: "discard", resolvedBy: "otro" }, { now: NOW });

    expect(first.ok && first.changed).toBe(true);
    expect(second.ok && second.changed).toBe(false);
    expect(second.ok && !second.changed && second.reason).toBe("already_resolved");
    // La segunda accion era `discard`: si hubiera corrido, la fila saldria de
    // los totales. No corrio.
    expect(second.ok && second.transaction.is_discarded).toBe(0);
    expect(listReviewResolutions(db, { transactionId: row.id })).toHaveLength(1);
  });

  // Esta es la unica puerta por la que un humano puede escribir un monto, y
  // solo se abre para una fila que el motor marco. Sin este guard, `correct`
  // seria un editor de montos arbitrario sobre todo el ledger.
  it("no toca una fila que nunca estuvo en revision", () => {
    const row = enRevision({ amount: 12.5, needs_review: false });

    const result = resolveReview(db, { id: row.id, action: "correct", amount: 999, resolvedBy: "mato" }, { now: NOW });

    expect(result.ok && !result.changed && result.reason).toBe("already_resolved");
    expect(result.ok && result.transaction.amount).toBe(12.5);
    expect(listReviewResolutions(db, { transactionId: row.id })).toHaveLength(0);
  });

  it("devuelve not_found para un id que no existe", () => {
    expect(resolveReview(db, { id: 9999, action: "confirm", resolvedBy: "mato" }, { now: NOW })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("exige saber quien resolvio", () => {
    const row = enRevision();

    expect(resolveReview(db, { id: row.id, action: "confirm", resolvedBy: "   " }, { now: NOW })).toEqual({
      ok: false,
      error: "resolved_by_required",
    });
    expect(queryReviewTransactions(db)).toHaveLength(1);
  });
});

describe("auditoria", () => {
  it("registra que se resolvio, como, por quien y cuando", () => {
    const row = enRevision();

    resolveReview(
      db,
      { id: row.id, action: "correct", amount: 41.07, resolvedBy: "mato", note: "monto leido del correo" },
      { now: NOW }
    );

    const [audit] = listReviewResolutions(db, { transactionId: row.id });
    expect(audit).toMatchObject({
      transaction_id: row.id,
      gmail_msg_id: row.gmail_msg_id,
      action: "correct",
      previous_amount: 0,
      new_amount: 41.07,
      note: "monto leido del correo",
      resolved_by: "mato",
      resolved_at: NOW.toISOString(),
    });
  });

  it("en confirm y discard deja el monto nuevo en null (no se toco plata)", () => {
    const a = enRevision({ gmail_msg_id: "a", amount: 10 });
    const b = enRevision({ gmail_msg_id: "b", amount: 20 });

    resolveReview(db, { id: a.id, action: "confirm", resolvedBy: "mato" }, { now: NOW });
    resolveReview(db, { id: b.id, action: "discard", resolvedBy: "mato" }, { now: NOW });

    expect(listReviewResolutions(db, { transactionId: a.id })[0]).toMatchObject({
      action: "confirm",
      previous_amount: 10,
      new_amount: null,
    });
    expect(listReviewResolutions(db, { transactionId: b.id })[0]).toMatchObject({
      action: "discard",
      previous_amount: 20,
      new_amount: null,
    });
  });

  it("lista todas las resoluciones, mas recientes primero, cuando no se filtra", () => {
    const a = enRevision({ gmail_msg_id: "a", amount: 10 });
    const b = enRevision({ gmail_msg_id: "b", amount: 20 });

    resolveReview(db, { id: a.id, action: "confirm", resolvedBy: "mato" }, { now: NOW });
    resolveReview(db, { id: b.id, action: "confirm", resolvedBy: "mato" }, { now: new Date("2026-08-30T13:00:00Z") });

    const all = listReviewResolutions(db);
    expect(all).toHaveLength(2);
    expect(all[0].transaction_id).toBe(b.id);
  });
});
