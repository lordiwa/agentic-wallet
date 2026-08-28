import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "./schema.js";
import {
  getTransactionByGmailMsgId,
  insertStatement,
  insertTransaction,
  listTransactions,
  updateTransactionReviewFlags,
} from "./repository.js";
import type { NewTransaction } from "./repository.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

function baseTx(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    gmail_msg_id: "msg-1",
    ts: "2026-07-01T12:00:00Z",
    direction: "out",
    type: "purchase",
    amount: 25.5,
    counterparty: "Supermaxi",
    ...overrides,
  };
}

describe("insertTransaction", () => {
  it("inserts a new transaction", () => {
    const { inserted, row } = insertTransaction(db, baseTx());
    expect(inserted).toBe(true);
    expect(row.gmail_msg_id).toBe("msg-1");
    expect(row.amount).toBe(25.5);
    expect(row.currency).toBe("USD");
    expect(row.source).toBe("claude");
  });

  it("is idempotent by gmail_msg_id (reinserting does not duplicate)", () => {
    insertTransaction(db, baseTx());
    const second = insertTransaction(db, baseTx({ amount: 999 }));
    expect(second.inserted).toBe(false);
    // the original row wins; the second attempt did not overwrite it
    expect(second.row.amount).toBe(25.5);
    const count = db.prepare("SELECT COUNT(*) as c FROM transactions").get() as { c: number };
    expect(count.c).toBe(1);
  });
});

// TASK-017 review fix (HIGH-1): insertTransaction alone is insert-only, so a
// later ingestion pass that reconciles an already-persisted row (e.g. a
// reverso email arriving after its consumo was first persisted) has no way
// to update it. updateTransactionReviewFlags is that narrow, scoped escape
// hatch — is_reversed/needs_review only, never amount or any other field.
describe("updateTransactionReviewFlags", () => {
  it("updates only is_reversed on the persisted row, leaving amount/other fields untouched", () => {
    insertTransaction(db, baseTx({ gmail_msg_id: "msg-consumo", amount: 9.42, is_reversed: false }));

    const updated = updateTransactionReviewFlags(db, "msg-consumo", { is_reversed: true });

    expect(updated?.is_reversed).toBe(1);
    expect(updated?.amount).toBe(9.42);
    expect(updated?.counterparty).toBe("Supermaxi");
  });

  it("updates only needs_review, independent of is_reversed", () => {
    insertTransaction(db, baseTx({ gmail_msg_id: "msg-x", needs_review: false }));

    const updated = updateTransactionReviewFlags(db, "msg-x", { needs_review: true });

    expect(updated?.needs_review).toBe(1);
    expect(updated?.is_reversed).toBe(0);
  });

  it("can update both flags in one call", () => {
    insertTransaction(db, baseTx({ gmail_msg_id: "msg-y" }));

    const updated = updateTransactionReviewFlags(db, "msg-y", { is_reversed: true, needs_review: true });

    expect(updated?.is_reversed).toBe(1);
    expect(updated?.needs_review).toBe(1);
  });

  it("is a no-op (does not throw) when no flags are given", () => {
    insertTransaction(db, baseTx({ gmail_msg_id: "msg-z", is_reversed: false }));

    const updated = updateTransactionReviewFlags(db, "msg-z", {});

    expect(updated?.is_reversed).toBe(0);
  });

  it("returns undefined for a gmail_msg_id that was never inserted", () => {
    expect(updateTransactionReviewFlags(db, "does-not-exist", { is_reversed: true })).toBeUndefined();
  });
});

describe("getTransactionByGmailMsgId", () => {
  it("returns undefined when not found", () => {
    expect(getTransactionByGmailMsgId(db, "nope")).toBeUndefined();
  });

  it("returns the row when found", () => {
    insertTransaction(db, baseTx());
    const row = getTransactionByGmailMsgId(db, "msg-1");
    expect(row?.gmail_msg_id).toBe("msg-1");
  });
});

describe("listTransactions", () => {
  beforeEach(() => {
    insertTransaction(
      db,
      baseTx({
        gmail_msg_id: "a",
        ts: "2026-07-01T00:00:00Z",
        type: "purchase",
        direction: "out",
        counterparty: "Supermaxi",
        amount: 10,
      })
    );
    insertTransaction(
      db,
      baseTx({
        gmail_msg_id: "b",
        ts: "2026-07-05T00:00:00Z",
        type: "deposit",
        direction: "in",
        counterparty: "Employer",
        amount: 500,
      })
    );
    insertTransaction(
      db,
      baseTx({
        gmail_msg_id: "c",
        ts: "2026-07-10T00:00:00Z",
        type: "purchase",
        direction: "out",
        counterparty: "Amazon",
        amount: 30,
      })
    );
  });

  it("filters by date range", () => {
    const rows = listTransactions(db, { from: "2026-07-02T00:00:00Z", to: "2026-07-10T00:00:00Z" });
    expect(rows.map((r) => r.gmail_msg_id).sort()).toEqual(["b", "c"]);
  });

  it("filters by type", () => {
    const rows = listTransactions(db, { type: "purchase" });
    expect(rows.map((r) => r.gmail_msg_id).sort()).toEqual(["a", "c"]);
  });

  it("filters by direction", () => {
    const rows = listTransactions(db, { direction: "in" });
    expect(rows.map((r) => r.gmail_msg_id)).toEqual(["b"]);
  });

  it("filters by counterparty", () => {
    const rows = listTransactions(db, { counterparty: "Amazon" });
    expect(rows.map((r) => r.gmail_msg_id)).toEqual(["c"]);
  });

  it("respects limit and offset", () => {
    const rows = listTransactions(db, { limit: 1, offset: 1 });
    expect(rows).toHaveLength(1);
  });

  it("returns rows ordered by ts descending by default", () => {
    const rows = listTransactions(db);
    expect(rows.map((r) => r.gmail_msg_id)).toEqual(["c", "b", "a"]);
  });
});

describe("insertStatement", () => {
  it("inserts a new statement", () => {
    const { inserted, row } = insertStatement(db, { gmail_msg_id: "stmt-1", card_mask: "1234", balance: 100 });
    expect(inserted).toBe(true);
    expect(row.card_mask).toBe("1234");
  });

  it("is idempotent by gmail_msg_id", () => {
    const first = insertStatement(db, { gmail_msg_id: "stmt-1", card_mask: "1234", balance: 100 });
    expect(first.inserted).toBe(true);
    const second = insertStatement(db, { gmail_msg_id: "stmt-1", card_mask: "9999", balance: 999 });
    expect(second.inserted).toBe(false);
    const count = db.prepare("SELECT COUNT(*) as c FROM statements").get() as { c: number };
    expect(count.c).toBe(1);
  });

  // TASK-014: F1-02 review flagged that a null/omitted gmail_msg_id used to
  // INSERT first and only THROW afterward on the post-insert lookup — a
  // throw-after-write, so a caller retry would duplicate the row. Statements
  // always carry a gmail_msg_id in this codebase; insertStatement now
  // rejects a missing one up front, before any write happens.
  it("rejects an insert with a missing gmail_msg_id, and leaves no partial row behind", () => {
    expect(() => insertStatement(db, { card_mask: "1234", balance: 100 })).toThrow();
    const count = db.prepare("SELECT COUNT(*) as c FROM statements").get() as { c: number };
    expect(count.c).toBe(0);
  });
});
