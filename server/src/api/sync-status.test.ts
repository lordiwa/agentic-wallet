import Database from "better-sqlite3";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { setSyncState } from "../db/repository.js";
import { migrate } from "../db/schema.js";
import { advanceSyncProgress, startSyncProgress } from "../db/sync-progress.js";
import { createApp } from "../index.js";

let db: Database.Database;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  app = createApp(db);
});

describe("GET /api/sync/status", () => {
  it("sin sync previo devuelve null, no una fecha inventada", () => {
    return request(app)
      .get("/api/sync/status")
      .expect(200)
      .then((res) => {
        expect(res.body).toEqual({ last_sync_ts: null, backlog: null });
      });
  });

  it("devuelve la fecha del ultimo sync completado", () => {
    setSyncState(db, { last_sync_ts: "2026-08-30T10:00:00Z", last_history: null });
    return request(app)
      .get("/api/sync/status")
      .expect(200)
      .then((res) => {
        expect(res.body.last_sync_ts).toBe("2026-08-30T10:00:00Z");
        expect(res.body.backlog).toBeNull();
      });
  });

  it("reporta el backlog a medias con lo que falta", () => {
    startSyncProgress(db, {
      sinceTs: "2026-08-01T00:00:00Z",
      startedAt: "2026-08-30T10:00:00Z",
      pendingIds: ["a", "b", "c"],
    });
    advanceSyncProgress(db, {
      pendingIds: ["b", "c"],
      processed: 1,
      totals: {},
      updatedAt: "2026-08-30T10:05:00Z",
    });

    return request(app)
      .get("/api/sync/status")
      .expect(200)
      .then((res) => {
        expect(res.body.backlog).toMatchObject({ processed: 1, total: 3, remaining: 2 });
      });
  });
});
