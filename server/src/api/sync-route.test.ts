import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { migrate } from "../db/schema.js";
import { createApp } from "../index.js";
import type { IngestSummary } from "../ingest/index.js";
import { MAX_SYNC_BATCH_SIZE, MAX_TRANSACTION_IDS } from "./schemas.js";
import type { SyncRunner } from "./sync-route.js";

function summary(overrides: Partial<IngestSummary> = {}): IngestSummary {
  return {
    seen: 2,
    inserted: 1,
    duplicates: 1,
    needsReview: 0,
    skipped: 0,
    statementsPersisted: 0,
    statementsNeedReview: 0,
    reversalsApplied: 0,
    ...overrides,
  };
}

function makeApp(syncRunner: SyncRunner | null) {
  const db = new Database(":memory:");
  migrate(db);
  return createApp(db, { syncRunner });
}

describe("POST /api/sync", () => {
  it("triggers the injected sync runner and returns its summary", async () => {
    const fakeSummary = summary({ seen: 5, inserted: 3, needsReview: 1 });
    const runner: SyncRunner = async () => fakeSummary;
    const app = makeApp(runner);

    const res = await request(app).post("/api/sync").expect(200);

    expect(res.body.summary).toEqual(fakeSummary);
  });

  it("returns a clean 503 (not a crash) when Gmail/Claude aren't configured", async () => {
    const app = makeApp(null);

    const res = await request(app).post("/api/sync").expect(503);

    expect(res.body).toEqual({ error: "gmail_not_configured" });
  });

  it("returns a clean 500 (not a crash) when the runner itself throws", async () => {
    const runner: SyncRunner = async () => {
      throw new Error("gmail search failed");
    };
    const app = makeApp(runner);

    const res = await request(app).post("/api/sync").expect(500);

    expect(res.body.error).toBe("sync_failed");
    expect(res.body.message).toContain("gmail search failed");
  });

  it("returns 409 busy on a concurrent call while a sync is already running", async () => {
    let resolveFirst!: () => void;
    const firstRunStarted = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    let releaseFirst!: () => void;
    const firstRunGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const runner: SyncRunner = async () => {
      resolveFirst();
      await firstRunGate;
      return summary();
    };
    const app = makeApp(runner);

    // A supertest `Test` only actually sends once something calls `.then`
    // on it (that's what triggers its internal `.end()`); chain `.then`
    // immediately to dispatch it now, without awaiting completion yet.
    const firstResultPromise = request(app)
      .post("/api/sync")
      .then((res) => res);
    await firstRunStarted;

    const secondRes = await request(app).post("/api/sync").expect(409);
    expect(secondRes.body).toEqual({ error: "sync_already_running" });

    releaseFirst();
    const firstRes = await firstResultPromise;
    expect(firstRes.status).toBe(200);
  });

  it("allows a new sync after the previous one finished", async () => {
    let calls = 0;
    const runner: SyncRunner = async () => {
      calls += 1;
      return summary();
    };
    const app = makeApp(runner);

    await request(app).post("/api/sync").expect(200);
    await request(app).post("/api/sync").expect(200);

    expect(calls).toBe(2);
  });
});

describe("POST /api/sync: batch_size (H19)", () => {
  it("pasa el batch_size del cuerpo al runner", async () => {
    let visto: number | undefined = -1;
    const runner: SyncRunner = async (options) => {
      visto = options?.batchSize;
      return summary();
    };
    const app = makeApp(runner);

    await request(app).post("/api/sync").send({ batch_size: 25 }).expect(200);

    expect(visto).toBe(25);
  });

  it("sin batch_size el runner no recibe ninguno: el default es del motor, no de la ruta", async () => {
    let visto: number | undefined = -1;
    const runner: SyncRunner = async (options) => {
      visto = options?.batchSize;
      return summary();
    };
    const app = makeApp(runner);

    await request(app).post("/api/sync").expect(200);

    expect(visto).toBeUndefined();
  });

  it("un batch_size que no es un entero positivo es un 400, no un lote absurdo", async () => {
    let llamado = false;
    const runner: SyncRunner = async () => {
      llamado = true;
      return summary();
    };
    const app = makeApp(runner);

    await request(app).post("/api/sync").send({ batch_size: 0 }).expect(400);
    await request(app).post("/api/sync").send({ batch_size: -3 }).expect(400);
    await request(app).post("/api/sync").send({ batch_size: 5000 }).expect(400);
    await request(app).post("/api/sync").send({ batch_size: "muchos" }).expect(400);

    expect(llamado).toBe(false);
  });
});

describe("POST /api/sync: inserted_ids (D7-b)", () => {
  it("devuelve los ids del lote afuera del resumen, como progress", async () => {
    const runner: SyncRunner = async () => ({ ...summary(), insertedIds: [7, 9] });
    const app = makeApp(runner);

    const res = await request(app).post("/api/sync").expect(200);

    expect(res.body.inserted_ids).toEqual([7, 9]);
  });

  it("un runner viejo sin insertedIds no rompe la respuesta", async () => {
    const runner: SyncRunner = async () => summary();
    const app = makeApp(runner);

    const res = await request(app).post("/api/sync").expect(200);

    expect(res.body.inserted_ids).toEqual([]);
  });
});

/**
 * El acoplamiento que la ronda 3 dejó escrito y sin candado (wargaming ronda 4,
 * W33 — clase de W24).
 *
 * El lote de un sync es el único productor legítimo de `?transaction_ids=` (la
 * cola post-sync, D7-b), así que un `batch_size` por encima del tope de ids
 * produce un lote cuya cola NO se puede pedir: el aviso del Resumen lleva a un
 * 400. Los dos números viven en `schemas.ts` y valen 500; hasta acá nada los
 * ataba, y subir uno solo era un cambio de una línea que ningún test veía.
 */
describe("batch_size no puede pasarse del tope de ids (W33)", () => {
  it("el lote más grande que el server acepta sigue cabiendo en un ?transaction_ids=", () => {
    expect(MAX_SYNC_BATCH_SIZE).toBeLessThanOrEqual(MAX_TRANSACTION_IDS);
  });

  it("y el schema rechaza exactamente ese tope, no uno más", async () => {
    const app = makeApp(async () => summary());

    await request(app).post("/api/sync").send({ batch_size: MAX_SYNC_BATCH_SIZE }).expect(200);
    await request(app).post("/api/sync").send({ batch_size: MAX_SYNC_BATCH_SIZE + 1 }).expect(400);
  });
});
