import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "./schema.js";

function openMemoryDb() {
  const db = new Database(":memory:");
  migrate(db);
  return db;
}

describe("migrate", () => {
  it("creates all 17 tables", () => {
    const db = openMemoryDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row: any) => row.name);
    expect(tables).toEqual([
      "category_rules",
      "classify_silenced",
      "conversations",
      "debts",
      "flexiahorro",
      "messages",
      "metas",
      "metas_avance",
      "review_resolutions",
      "saldos",
      "savings",
      "statements",
      "strategy_config",
      "sueldos",
      "sync_progress",
      "sync_state",
      "transactions",
    ]);
  });

  it("is idempotent (safe to run twice)", () => {
    const db = openMemoryDb();
    expect(() => migrate(db)).not.toThrow();
  });

  it("enforces UNIQUE on transactions.gmail_msg_id", () => {
    const db = openMemoryDb();
    const insert = db.prepare(
      "INSERT INTO transactions (gmail_msg_id, ts, direction, type, amount) VALUES (?, ?, ?, ?, ?)"
    );
    insert.run("msg-1", "2026-07-01T00:00:00Z", "out", "purchase", 10);
    expect(() => insert.run("msg-1", "2026-07-02T00:00:00Z", "out", "purchase", 20)).toThrow();
  });

  it("enforces UNIQUE on statements.gmail_msg_id", () => {
    const db = openMemoryDb();
    const insert = db.prepare("INSERT INTO statements (gmail_msg_id) VALUES (?)");
    insert.run("stmt-1");
    expect(() => insert.run("stmt-1")).toThrow();
  });

  it("applies defaults for is_reversed/is_internal/needs_review/source/created_at/currency", () => {
    const db = openMemoryDb();
    db.prepare(
      "INSERT INTO transactions (gmail_msg_id, ts, direction, type, amount) VALUES (?, ?, ?, ?, ?)"
    ).run("msg-2", "2026-07-01T00:00:00Z", "out", "purchase", 10);
    const row: any = db.prepare("SELECT * FROM transactions WHERE gmail_msg_id = ?").get("msg-2");
    expect(row.is_reversed).toBe(0);
    expect(row.is_internal).toBe(0);
    expect(row.needs_review).toBe(0);
    expect(row.source).toBe("claude");
    expect(row.currency).toBe("USD");
    expect(typeof row.created_at).toBe("string");
    expect(row.created_at.length).toBeGreaterThan(0);
  });

  it("creates indexes on transactions(ts, type, direction, counterparty)", () => {
    const db = openMemoryDb();
    const indexes = db.prepare("PRAGMA index_list(transactions)").all() as { name: string }[];
    const indexedColumns = indexes.map((idx) => {
      const cols = db.prepare(`PRAGMA index_info(${idx.name})`).all() as { name: string }[];
      return cols.map((c) => c.name);
    });
    for (const col of ["ts", "type", "direction", "counterparty"]) {
      expect(indexedColumns.some((cols) => cols.includes(col))).toBe(true);
    }
  });

  it("enforces the sync_state singleton check (id = 1)", () => {
    const db = openMemoryDb();
    db.prepare("INSERT INTO sync_state (id, last_sync_ts) VALUES (1, ?)").run("2026-07-01T00:00:00Z");
    expect(() => db.prepare("INSERT INTO sync_state (id, last_sync_ts) VALUES (2, ?)").run("x")).toThrow();
  });
});
