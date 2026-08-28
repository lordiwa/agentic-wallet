/**
 * Integration test for GET /api/brief (spec §13 AC4, F2-F / TASK-027):
 * confirms the route wires HTTP query params <-> buildDailyBrief faithfully
 * (date defaulting, explicit ?date=, and 400 on a malformed date) rather
 * than duplicating the brief's own arithmetic -- same pattern as
 * api/strategy-routes.test.ts for the other F2-D endpoints.
 */
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../index.js";
import { migrate } from "../db/schema.js";
import { insertTransaction } from "../db/repository.js";
import type { NewTransaction } from "../db/repository.js";
import { buildDailyBrief } from "./build-brief.js";

// local July 10, 2026, 08:00 -- so "yesterday" defaults to July 9.
const FIXED_NOW = new Date("2026-07-10T13:00:00.000Z");

let db: Database.Database;
let app: ReturnType<typeof createApp>;

function tx(overrides: Partial<NewTransaction> = {}): NewTransaction {
  return {
    gmail_msg_id: `tx-${Math.random()}`,
    ts: "2026-07-09T12:00:00Z",
    direction: "out",
    type: "debito",
    amount: 25,
    counterparty: "Supermaxi",
    ...overrides,
  };
}

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  app = createApp(db);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/brief", () => {
  it("defaults to yesterday in local time and matches buildDailyBrief() directly", () => {
    insertTransaction(db, tx({ gmail_msg_id: "g1", amount: 25, ts: "2026-07-09T12:00:00Z" }));

    return request(app)
      .get("/api/brief")
      .expect(200)
      .then((res) => {
        expect(res.body).toEqual(buildDailyBrief(db, { now: FIXED_NOW }));
        expect(res.body.date).toBe("2026-07-09");
        expect(res.body.totalGastado).toBe(25);
      });
  });

  it("honors an explicit ?date= override", () => {
    insertTransaction(db, tx({ gmail_msg_id: "g1", amount: 25, ts: "2026-07-09T12:00:00Z" }));
    insertTransaction(db, tx({ gmail_msg_id: "g2", amount: 60, ts: "2026-07-05T12:00:00Z" }));

    return request(app)
      .get("/api/brief")
      .query({ date: "2026-07-05" })
      .expect(200)
      .then((res) => {
        expect(res.body.date).toBe("2026-07-05");
        expect(res.body.totalGastado).toBe(60);
      });
  });

  it("400s on a malformed date", () => {
    return request(app).get("/api/brief").query({ date: "not-a-date" }).expect(400);
  });

  it("degrades to a clean empty brief on an empty database", () => {
    return request(app)
      .get("/api/brief")
      .expect(200)
      .then((res) => {
        expect(res.body.totalGastado).toBe(0);
        expect(res.body.topConsumos).toEqual([]);
        expect(res.body.recordatorioTarjeta).toBe(false);
      });
  });
});
