import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "./schema.js";
import { advanceSyncProgress, clearSyncProgress, getSyncProgress, startSyncProgress } from "./sync-progress.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

describe("sync_progress", () => {
  it("no hay checkpoint hasta que se abre un backlog", () => {
    expect(getSyncProgress(db)).toBeUndefined();
  });

  it("startSyncProgress guarda el backlog completo y arranca en cero", () => {
    const progress = startSyncProgress(db, {
      sinceTs: "2026-07-01T00:00:00.000Z",
      startedAt: "2026-07-20T10:00:00.000Z",
      pendingIds: ["a", "b", "c"],
    });

    expect(progress).toMatchObject({ total: 3, processed: 0, pendingIds: ["a", "b", "c"] });
    expect(getSyncProgress(db)).toEqual(progress);
  });

  it("un backlog nuevo pisa al anterior en vez de acumular filas", () => {
    startSyncProgress(db, { sinceTs: "s1", startedAt: "t1", pendingIds: ["a"] });
    startSyncProgress(db, { sinceTs: "s2", startedAt: "t2", pendingIds: ["x", "y"] });

    const rows = db.prepare("SELECT COUNT(*) as c FROM sync_progress").get() as { c: number };
    expect(rows.c).toBe(1);
    expect(getSyncProgress(db)).toMatchObject({ sinceTs: "s2", startedAt: "t2", total: 2 });
  });

  it("advanceSyncProgress descuenta lo procesado y acumula los totales", () => {
    startSyncProgress(db, { sinceTs: "s", startedAt: "t", pendingIds: ["a", "b", "c"] });

    advanceSyncProgress(db, {
      pendingIds: ["c"],
      processed: 2,
      totals: { seen: 2, inserted: 2 },
      updatedAt: "2026-07-20T10:01:00.000Z",
    });

    expect(getSyncProgress(db)).toMatchObject({
      total: 3,
      processed: 2,
      pendingIds: ["c"],
      totals: { seen: 2, inserted: 2 },
      updatedAt: "2026-07-20T10:01:00.000Z",
    });
  });

  it("el checkpoint sobrevive al cierre de la base (esta en disco, no en memoria del proceso)", () => {
    // Una base :memory: se pierde al cerrar, asi que la prueba de durabilidad
    // se hace releyendo con una conexion nueva sobre el mismo archivo temporal.
    const dir = mkdtempSync(path.join(tmpdir(), "wallet-sync-progress-"));
    const file = path.join(dir, "wallet.sqlite");
    try {
      const first = new Database(file);
      migrate(first);
      startSyncProgress(first, { sinceTs: "s", startedAt: "t", pendingIds: ["a", "b"] });
      first.close();

      const second = new Database(file);
      expect(getSyncProgress(second)).toMatchObject({ pendingIds: ["a", "b"], processed: 0 });
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clearSyncProgress borra el checkpoint (backlog terminado)", () => {
    startSyncProgress(db, { sinceTs: "s", startedAt: "t", pendingIds: ["a"] });
    clearSyncProgress(db);
    expect(getSyncProgress(db)).toBeUndefined();
  });
});
