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

  it("aTiempo and requeridoPorQuincena are null -- not true/saldoCorte -- when fechaMaxima is missing", () => {
    seedDatabase(db);
    insertStatement(db, { gmail_msg_id: "stmt-1", balance: 150, issue_date: "2026-07-01", due_date: null });
    setSueldo(["15-15"], 1000);

    const status = tarjetaStatus(db, new Date("2026-07-20T12:00:00.000Z"));

    expect(status?.fechaMaxima).toBeNull();
    // Used to be `true` ("nothing to be late for"). On a card carrying a
    // balance that reads as reassurance, and it disarmed the brief's
    // tarjeta_riesgo_atraso alert. Not knowing is its own answer.
    expect(status?.aTiempo).toBeNull();
    expect(status?.requeridoPorQuincena).toBeNull();
    // The balance itself is still known: only the plan around it isn't.
    expect(status?.saldoCorte).toBe(150);
  });

  it("minimo is null -- not 0 -- when the statement carried no min_payment", () => {
    seedDatabase(db);
    // `ingestStatementEmail` persists a statement as long as ONE of
    // balance/min_payment/due_date parsed, so a row with a balance and no
    // minimum is a shape the real ledger produces (Mato's five statements are
    // exactly this). `minimo: 0` there says "you owe nothing this month".
    insertStatement(db, { gmail_msg_id: "stmt-1", balance: 150, min_payment: null, due_date: "2026-09-20" });

    expect(tarjetaStatus(db, new Date("2026-07-20T12:00:00.000Z"))?.minimo).toBeNull();
  });

  it("minimo is 0 when the statement really said 0", () => {
    seedDatabase(db);
    insertStatement(db, { gmail_msg_id: "stmt-1", balance: 150, min_payment: 0, due_date: "2026-09-20" });

    expect(tarjetaStatus(db, new Date("2026-07-20T12:00:00.000Z"))?.minimo).toBe(0);
  });

  it("saldoActualEstimado is null -- not saldoCorte -- when there is no issue_date to measure new charges from", () => {
    seedDatabase(db);
    insertStatement(db, { gmail_msg_id: "stmt-1", balance: 150, issue_date: null, due_date: "2026-09-20" });
    insertTransaction(db, tx({ amount: 45, ts: "2026-07-10T12:00:00Z" }));

    const status = tarjetaStatus(db, new Date("2026-07-20T12:00:00.000Z"));

    // Answering 150 would report "no new spending since the cutoff" when the
    // truth is that there is no cutoff to compare against.
    expect(status?.saldoActualEstimado).toBeNull();
    expect(status?.saldoCorte).toBe(150);
  });
});
