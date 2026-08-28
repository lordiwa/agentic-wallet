import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { seedDatabase } from "../seed/seed.js";
import { insertStatement, insertTransaction } from "../db/repository.js";
import type { NewTransaction } from "../db/repository.js";
import { tarjetaStatus } from "./card.js";

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
    ts: "2026-07-05T12:00:00Z",
    direction: "out",
    type: "credito",
    amount: 10,
    ...overrides,
  };
}

function setSueldo(diasPago: string[], montoEstimado = 1000): void {
  db.prepare("UPDATE strategy_config SET value = ? WHERE key = 'sueldo'").run(
    JSON.stringify({ fuente: "Acme", cadencia: "quincenal", montoEstimado, diasPago })
  );
}

describe("tarjetaStatus (spec §9.5)", () => {
  it("returns null when there is no statement yet", () => {
    seedDatabase(db);
    expect(tarjetaStatus(db)).toBeNull();
  });

  it("reads saldoCorte/minimo/fechaMaxima straight from the latest statement", () => {
    seedDatabase(db);
    insertStatement(db, {
      gmail_msg_id: "stmt-1",
      balance: 150,
      min_payment: 20,
      issue_date: "2026-07-01",
      due_date: "2026-09-20",
    });
    setSueldo(["15-15"], 1000);

    const status = tarjetaStatus(db, new Date("2026-07-20T12:00:00.000Z"));

    expect(status?.saldoCorte).toBe(150);
    expect(status?.minimo).toBe(20);
    expect(status?.fechaMaxima).toBe("2026-09-20");
  });

  it("picks the statement with the latest issue_date when more than one exists", () => {
    seedDatabase(db);
    insertStatement(db, { gmail_msg_id: "old", balance: 50, issue_date: "2026-05-01", due_date: "2026-06-05" });
    insertStatement(db, { gmail_msg_id: "new", balance: 300, issue_date: "2026-07-01", due_date: "2026-08-05" });

    expect(tarjetaStatus(db)?.saldoCorte).toBe(300);
  });

  it("adds 'credito' charges strictly after issue_date into saldoActualEstimado, ignoring earlier charges", () => {
    seedDatabase(db);
    insertStatement(db, { gmail_msg_id: "stmt-1", balance: 150, issue_date: "2026-07-01", due_date: "2026-09-20" });
    insertTransaction(db, tx({ gmail_msg_id: "before", amount: 999, ts: "2026-06-25T12:00:00Z" })); // before issue_date -> ignored
    insertTransaction(db, tx({ gmail_msg_id: "after", amount: 45, ts: "2026-07-05T12:00:00Z" })); // after issue_date -> counted

    expect(tarjetaStatus(db)?.saldoActualEstimado).toBe(195); // 150 + 45
  });

  it("excludes internal/reversed/needs_review/reverso rows from saldoActualEstimado's new-charges sum", () => {
    seedDatabase(db);
    insertStatement(db, { gmail_msg_id: "stmt-1", balance: 150, issue_date: "2026-07-01", due_date: "2026-09-20" });
    insertTransaction(db, tx({ gmail_msg_id: "internal", amount: 20, is_internal: true, ts: "2026-07-05T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "reversed", amount: 20, is_reversed: true, ts: "2026-07-05T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "review", amount: 20, needs_review: true, ts: "2026-07-05T12:00:00Z" }));

    expect(tarjetaStatus(db)?.saldoActualEstimado).toBe(150);
  });

  it("aTiempo is true and requeridoPorQuincena splits saldoCorte evenly when there are enough paychecks before fechaMaxima", () => {
    seedDatabase(db);
    insertStatement(db, { gmail_msg_id: "stmt-1", balance: 150, issue_date: "2026-07-01", due_date: "2026-09-20" });
    setSueldo(["15-15"], 1000); // no ledger history -> fallback day 15 each month

    // now = July 20 -> next paydays before Sep 20 (inclusive) are Aug 15 and Sep 15 -> 2 paychecks
    const status = tarjetaStatus(db, new Date("2026-07-20T12:00:00.000Z"));

    expect(status?.aTiempo).toBe(true); // 2 * 1000 >= 150
    expect(status?.requeridoPorQuincena).toBe(75); // 150 / 2
  });

  it("aTiempo is false and requeridoPorQuincena is the whole saldoCorte when no paycheck lands before fechaMaxima", () => {
    seedDatabase(db);
    insertStatement(db, { gmail_msg_id: "stmt-1", balance: 150, issue_date: "2026-07-01", due_date: "2026-07-22" });
    setSueldo(["15-15"], 1000); // July 15 already passed; next payday is Aug 15, after the due date

    const status = tarjetaStatus(db, new Date("2026-07-20T12:00:00.000Z"));

    expect(status?.aTiempo).toBe(false);
    expect(status?.requeridoPorQuincena).toBe(150); // divide-by-zero guard: 0 paychecks before due date
  });

  it("aTiempo is true and requeridoPorQuincena falls back to saldoCorte when fechaMaxima is missing", () => {
    seedDatabase(db);
    insertStatement(db, { gmail_msg_id: "stmt-1", balance: 150, issue_date: "2026-07-01", due_date: null });
    setSueldo(["15-15"], 1000);

    const status = tarjetaStatus(db, new Date("2026-07-20T12:00:00.000Z"));

    expect(status?.fechaMaxima).toBeNull();
    expect(status?.aTiempo).toBe(true); // nothing to be late for
    expect(status?.requeridoPorQuincena).toBe(150);
  });
});
