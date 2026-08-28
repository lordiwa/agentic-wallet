import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { seedFixture } from "../seed/seed.fixture.js";
import { insertTransaction } from "../db/repository.js";
import type { NewTransaction } from "../db/repository.js";
import { transferenciasMes } from "./transfers.js";

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
    type: "transferencia",
    amount: 10,
    ...overrides,
  };
}

const NOW = new Date("2026-07-15T12:00:00.000Z"); // local current month: July 2026

describe("transferenciasMes (spec §9.6)", () => {
  it("sums out-of-pocket transferencias in the current local time month, ranked by counterparty", () => {
    seedFixture(db); // topeTransferenciasMensual: 1200

    insertTransaction(db, tx({ gmail_msg_id: "t1", counterparty: "Juan", amount: 100, ts: "2026-07-05T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "t2", counterparty: "Juan", amount: 50, ts: "2026-07-10T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "t3", counterparty: "Maria", amount: 300, ts: "2026-07-12T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "t4", counterparty: "Pedro", amount: 50, ts: "2026-07-13T12:00:00Z" }));

    // exclusions
    insertTransaction(db, tx({ gmail_msg_id: "internal", counterparty: "MeMismo", amount: 200, is_internal: true }));
    insertTransaction(db, tx({ gmail_msg_id: "other-month", counterparty: "Ana", amount: 80, ts: "2026-06-15T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "received", counterparty: "Luis", amount: 60, direction: "in" }));
    insertTransaction(db, tx({ gmail_msg_id: "reversed", counterparty: "Sara", amount: 70, is_reversed: true }));
    insertTransaction(db, tx({ gmail_msg_id: "review", counterparty: "Nico", amount: 90, needs_review: true }));

    const status = transferenciasMes(db, NOW);

    expect(status.total).toBe(500); // 100 + 50 + 300 + 50
    expect(status.tope).toBe(1200);
    expect(status.restante).toBe(700);
    expect(status.sobrepasado).toBe(false);
    expect(status.topContrapartes).toEqual([
      { counterparty: "Maria", total: 300 },
      { counterparty: "Juan", total: 150 },
      { counterparty: "Pedro", total: 50 },
    ]);
  });

  it("flags sobrepasado true and a negative restante once the tope is exceeded", () => {
    seedFixture(db);
    db.prepare("UPDATE strategy_config SET value = ? WHERE key = 'topeTransferenciasMensual'").run(JSON.stringify(200));
    insertTransaction(db, tx({ gmail_msg_id: "t1", counterparty: "Juan", amount: 250, ts: "2026-07-05T12:00:00Z" }));

    const status = transferenciasMes(db, NOW);

    expect(status.total).toBe(250);
    expect(status.tope).toBe(200);
    expect(status.restante).toBe(-50);
    expect(status.sobrepasado).toBe(true);
  });

  it("caps topContrapartes at the top 5 counterparties by total, descending", () => {
    seedFixture(db);
    const amounts = [10, 60, 20, 50, 30, 40]; // 6 counterparties
    amounts.forEach((amount, i) => {
      insertTransaction(db, tx({ gmail_msg_id: `c${i}`, counterparty: `Persona${i}`, amount, ts: "2026-07-05T12:00:00Z" }));
    });

    const status = transferenciasMes(db, NOW);

    expect(status.topContrapartes).toHaveLength(5);
    expect(status.topContrapartes.map((c) => c.total)).toEqual([60, 50, 40, 30, 20]); // drops the smallest (10)
  });

  it("degrades to zero totals without crashing on an empty ledger", () => {
    expect(() => transferenciasMes(db, NOW)).not.toThrow();
    const status = transferenciasMes(db, NOW);
    expect(status.total).toBe(0);
    expect(status.sobrepasado).toBe(false);
    expect(status.topContrapartes).toEqual([]);
  });
});
