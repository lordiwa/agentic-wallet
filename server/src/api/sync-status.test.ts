import Database from "better-sqlite3";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { setSyncState } from "../db/repository.js";
import { migrate } from "../db/schema.js";
import { advanceSyncProgress, startSyncProgress } from "../db/sync-progress.js";
import { createApp } from "../index.js";
import type { SyncRunner } from "./sync-route.js";
import type { SyncResult } from "../sync/run-sync.js";

/** Lo minimo que un runner tiene que devolver para que la ruta responda. */
const EMPTY_RESULT: SyncResult = {
  seen: 0,
  inserted: 0,
  duplicates: 0,
  needsReview: 0,
  skipped: 0,
  statementsPersisted: 0,
  statementsNeedReview: 0,
  reversalsApplied: 0,
  insertedIds: [],
  cumulative: {
    seen: 0,
    inserted: 0,
    duplicates: 0,
    needsReview: 0,
    skipped: 0,
    statementsPersisted: 0,
    statementsNeedReview: 0,
    reversalsApplied: 0,
  },
  progress: { processed: 0, total: 0, remaining: 0, complete: true },
};

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
        expect(res.body).toEqual({ last_sync_ts: null, running: false, backlog: null });
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

  /**
   * R9. Sin esto, la unica forma de enterarse de que hay un lote en vuelo era
   * comerse el 409 de `POST /api/sync` — y un lote tarda minutos.
   */
  describe("running (R9)", () => {
    it("un backlog a medias NO es un sync corriendo: son dos preguntas distintas", async () => {
      startSyncProgress(db, {
        sinceTs: "2026-08-01T00:00:00Z",
        startedAt: "2026-08-30T10:00:00Z",
        pendingIds: ["a", "b"],
      });

      const res = await request(app).get("/api/sync/status").expect(200);
      expect(res.body.backlog).not.toBeNull();
      expect(res.body.running).toBe(false);
    });

    it("mientras POST /api/sync corre, el status lo dice", async () => {
      let arranco!: () => void;
      const corriendo = new Promise<void>((resolve) => {
        arranco = resolve;
      });
      let soltar!: () => void;
      const traba = new Promise<void>((resolve) => {
        soltar = resolve;
      });

      const runner: SyncRunner = async () => {
        arranco();
        await traba;
        return { ...EMPTY_RESULT };
      };
      const conRunner = createApp(db, { syncRunner: runner });

      // Se dispara sin esperarla: supertest recien manda cuando alguien
      // encadena un `.then`.
      const enVuelo = request(conRunner)
        .post("/api/sync")
        .then((res) => res);
      await corriendo;

      const durante = await request(conRunner).get("/api/sync/status").expect(200);
      expect(durante.body.running).toBe(true);

      soltar();
      await enVuelo;

      const despues = await request(conRunner).get("/api/sync/status").expect(200);
      expect(despues.body.running).toBe(false);
    });
  });
});
