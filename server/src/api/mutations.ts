/**
 * Write helpers for the STRATEGY API's two mutation endpoints (F2-D,
 * TASK-026 AC3/AC4): marking a personal debt paid and updating the
 * "colchon" buffer reservation. Kept here rather than in db/repository.ts
 * (out of this ticket's file boundary) -- parameterized statements against
 * the injected db handle, same pattern queries.ts already uses for reads.
 */
import type Database from "better-sqlite3";

export interface DebtRow {
  id: number;
  person: string;
  amount: number;
  kind: string;
  status: string;
  note: string | null;
}

export interface SavingsRow {
  id: number;
  label: string | null;
  target: number | null;
  reserved: number | null;
  updated_at: string | null;
}

/** Debt by id, or undefined if it doesn't exist -- 404 territory. */
export function getDebtById(db: Database.Database, id: number): DebtRow | undefined {
  return db.prepare("SELECT * FROM debts WHERE id = ?").get(id) as DebtRow | undefined;
}

/**
 * Marks a debt 'paid' (AC3). Idempotent: calling it on an already-paid debt
 * is a no-op that still returns the row unchanged. Returns `undefined` when
 * the id doesn't exist so the route can 404 without a separate existence
 * check.
 */
export function markDebtPaid(db: Database.Database, id: number): DebtRow | undefined {
  const existing = getDebtById(db, id);
  if (!existing) return undefined;
  if (existing.status !== "paid") {
    db.prepare("UPDATE debts SET status = 'paid' WHERE id = ?").run(id);
  }
  return getDebtById(db, id);
}

/** Latest 'colchon' savings row -- mirrors the strategy engine's own lookup (strategy/balance.ts colchonStatus). */
function latestColchonRow(db: Database.Database): SavingsRow | undefined {
  return db.prepare("SELECT * FROM savings WHERE label = 'colchon' ORDER BY id DESC LIMIT 1").get() as
    | SavingsRow
    | undefined;
}

/**
 * Updates the 'colchon' savings row's `reserved` amount (+ updated_at)
 * (AC4). Inserts a fresh row when none exists yet, leaving `target` null --
 * no target was supplied by this endpoint, so none is invented.
 */
export function updateBufferReserved(db: Database.Database, reserved: number): SavingsRow {
  const existing = latestColchonRow(db);
  if (existing) {
    db.prepare("UPDATE savings SET reserved = ?, updated_at = datetime('now') WHERE id = ?").run(reserved, existing.id);
  } else {
    db.prepare(
      "INSERT INTO savings (label, target, reserved, updated_at) VALUES ('colchon', NULL, ?, datetime('now'))"
    ).run(reserved);
  }
  return latestColchonRow(db) as SavingsRow;
}
