import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { insertTransaction, getTransactionByGmailMsgId } from "../db/repository.js";
import type { NewTransaction } from "../db/repository.js";
import { backfillCategories } from "./backfill.js";
import { upsertCategoryRule } from "./rules-repository.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

function tx(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    gmail_msg_id: "msg-1",
    ts: "2026-07-01T12:00:00Z",
    direction: "out",
    type: "retiro",
    amount: 20,
    ...overrides,
  };
}

describe("backfillCategories", () => {
  it("categorizes rows with a NULL category", async () => {
    insertTransaction(db, tx({ gmail_msg_id: "m1", type: "retiro" }));
    insertTransaction(db, tx({ gmail_msg_id: "m2", type: "debito", counterparty: "VETERINARIA LUNA" }));

    const updated = await backfillCategories(db);

    expect(updated).toBe(2);
    // Type-driven: works with no merchant rules configured at all.
    expect(getTransactionByGmailMsgId(db, "m1")?.category).toBe("efectivo");
    // No rule for this merchant yet, so it must land in 'otros', not in a
    // category guessed from someone else's merchant list.
    expect(getTransactionByGmailMsgId(db, "m2")?.category).toBe("otros");
  });

  it("applies the user's own merchant rules from category_rules", async () => {
    upsertCategoryRule(db, "Veterinaria Luna", "mascota");
    insertTransaction(db, tx({ gmail_msg_id: "m1", type: "debito", counterparty: "VETERINARIA LUNA suc 2" }));

    const updated = await backfillCategories(db);

    expect(updated).toBe(1);
    expect(getTransactionByGmailMsgId(db, "m1")?.category).toBe("mascota");
  });

  it("categorizes rows with an empty-string category the same as NULL", async () => {
    insertTransaction(db, tx({ gmail_msg_id: "m1", type: "recarga", counterparty: "Claro", category: "" }));

    const updated = await backfillCategories(db);

    expect(updated).toBe(1);
    expect(getTransactionByGmailMsgId(db, "m1")?.category).toBe("recarga");
  });

  it("is idempotent: a second run updates nothing and never repisa an existing category", async () => {
    insertTransaction(db, tx({ gmail_msg_id: "m1", type: "retiro" }));

    const first = await backfillCategories(db);
    expect(first).toBe(1);

    const second = await backfillCategories(db);
    expect(second).toBe(0);
    expect(getTransactionByGmailMsgId(db, "m1")?.category).toBe("efectivo");
  });

  it("never overwrites a category set manually (or by any prior process)", async () => {
    // A human (or another process) hand-set this row's category to
    // something categorize() would never produce on its own — proves
    // backfill treats any non-empty category as already-decided.
    insertTransaction(db, tx({ gmail_msg_id: "m1", type: "retiro", category: "comida" }));

    const updated = await backfillCategories(db);

    expect(updated).toBe(0);
    expect(getTransactionByGmailMsgId(db, "m1")?.category).toBe("comida");
  });

  it("returns 0 and touches nothing when there are no transactions", async () => {
    const updated = await backfillCategories(db);
    expect(updated).toBe(0);
  });
});
