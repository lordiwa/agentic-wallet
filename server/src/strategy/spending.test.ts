import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { insertTransaction } from "../db/repository.js";
import type { NewTransaction } from "../db/repository.js";
import { upsertCategoryRule } from "../category/rules-repository.js";
import { spendingByCategory } from "./spending.js";

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

const JULY = { from: new Date("2026-07-01T05:00:00.000Z"), to: new Date("2026-08-01T05:00:00.000Z") };

describe("spendingByCategory (spec §9.8)", () => {
  it("aggregates only direction='out' gasto rows, categorized via F2-B's categorize()", () => {
    // income must NEVER inflate a category bucket (F2-B review critical fix)
    insertTransaction(db, tx({ gmail_msg_id: "income", direction: "in", type: "sueldo", amount: 1000 }));

    // Establishment categories come from the user's own category_rules, never
    // from a shipped merchant list -- so the rule is part of the fixture.
    upsertCategoryRule(db, "veterinaria", "mascota");
    insertTransaction(db, tx({ gmail_msg_id: "g1", type: "debito", counterparty: "VETERINARIA CENTRAL", amount: 25 }));
    insertTransaction(db, tx({ gmail_msg_id: "g2", type: "retiro", amount: 40 }));
    insertTransaction(db, tx({ gmail_msg_id: "g3", type: "transferencia", counterparty: "Persona Dos", amount: 60 }));

    // exclusions
    insertTransaction(db, tx({ gmail_msg_id: "internal", type: "transferencia", is_internal: true, amount: 200 }));
    insertTransaction(db, tx({ gmail_msg_id: "reversed", is_reversed: true, amount: 15 }));
    insertTransaction(db, tx({ gmail_msg_id: "review", type: "servicio", needs_review: true, amount: 12 }));
    insertTransaction(db, tx({ gmail_msg_id: "reverso", type: "reverso", amount: 9 }));
    insertTransaction(db, tx({ gmail_msg_id: "out-of-range", amount: 999, ts: "2026-06-15T12:00:00Z" }));

    const result = spendingByCategory(db, JULY);

    expect(result).toEqual({
      mascota: 25,
      efectivo: 40,
      transferencia_persona: 60,
    });
  });

  it("returns an empty object for a period with only income, no gasto", () => {
    insertTransaction(db, tx({ gmail_msg_id: "income", direction: "in", type: "sueldo", amount: 1000 }));

    expect(spendingByCategory(db, JULY)).toEqual({});
  });

  it("returns an empty object without crashing on an empty ledger", () => {
    expect(() => spendingByCategory(db, JULY)).not.toThrow();
    expect(spendingByCategory(db, JULY)).toEqual({});
  });

  it("sums multiple transactions in the same category", () => {
    insertTransaction(db, tx({ gmail_msg_id: "r1", type: "retiro", amount: 20 }));
    insertTransaction(db, tx({ gmail_msg_id: "r2", type: "retiro", amount: 30 }));

    expect(spendingByCategory(db, JULY)).toEqual({ efectivo: 50 });
  });
});
