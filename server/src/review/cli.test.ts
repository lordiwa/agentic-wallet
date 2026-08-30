import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { insertTransaction, type NewTransaction } from "../db/repository.js";
import { runReviewCli, type ReviewCliDeps } from "./cli.js";

// Base en archivo y no `:memory:`: el CLI CIERRA la base que abre (su
// `finally`), asi que compartir un handle entre corridas lo dejaria cerrado
// para la segunda. Un archivo reproduce lo que pasa de verdad — cada corrida
// abre el suyo — y es lo que hace posible testear la idempotencia.
let dir: string;
let dbPath: string;
let db: Database.Database;
let lines: string[];
let deps: ReviewCliDeps;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "wallet-review-cli-"));
  dbPath = path.join(dir, "test.sqlite");
  db = new Database(dbPath);
  migrate(db);
  lines = [];
  deps = { openDatabase: () => new Database(dbPath), log: (line) => lines.push(line) };
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function enRevision(overrides: Partial<NewTransaction> = {}): number {
  return insertTransaction(db, {
    gmail_msg_id: `msg-${overrides.gmail_msg_id ?? "1"}`,
    ts: "2026-07-22T12:00:00Z",
    direction: "out",
    type: "debito",
    amount: null,
    needs_review: true,
    counterparty: "COMERCIO EJEMPLO",
    ...overrides,
  }).row.id;
}

/** Toda salida del CLI es JSON en una sola linea de log. */
function output(): any {
  return JSON.parse(lines.at(-1) as string);
}

describe("runReviewCli", () => {
  it("sin argumentos lista la cola como JSON", async () => {
    enRevision();

    expect(await runReviewCli([], deps)).toBe(0);
    expect(output()).toMatchObject({ ok: true, count: 1 });
  });

  it("--confirm saca la fila de la cola", async () => {
    const id = enRevision({ amount: 12.5 });

    expect(await runReviewCli(["--confirm", String(id)], deps)).toBe(0);
    expect(output()).toMatchObject({ ok: true, changed: true });
    expect(output().transaction.needs_review).toBe(0);
  });

  it("--correct <id>=<monto> escribe el monto que afirma el humano", async () => {
    const id = enRevision();

    expect(await runReviewCli(["--correct", `${id}=41.07`, "--by", "mato"], deps)).toBe(0);
    expect(output().transaction.amount).toBe(41.07);
    expect(output().resolution).toMatchObject({ resolved_by: "mato", action: "correct" });
  });

  it("--discard deja la fila fuera de los totales", async () => {
    const id = enRevision({ amount: 12.5 });

    expect(await runReviewCli(["--discard", String(id)], deps)).toBe(0);
    expect(output().transaction.is_discarded).toBe(1);
  });

  it("acepta --note y --by tanto pegados como separados", async () => {
    const id = enRevision({ amount: 12.5 });

    expect(await runReviewCli(["--confirm", String(id), "--by=mato", "--note", "revisado a mano"], deps)).toBe(0);
    expect(output().resolution).toMatchObject({ resolved_by: "mato", note: "revisado a mano" });
  });

  it("sin --by el registro dice que se resolvio por CLI", async () => {
    const id = enRevision({ amount: 12.5 });

    await runReviewCli(["--confirm", String(id)], deps);
    expect(output().resolution.resolved_by).toBe("cli");
  });

  it("--history lista las resoluciones ya hechas", async () => {
    const id = enRevision({ amount: 12.5 });
    await runReviewCli(["--confirm", String(id)], deps);

    expect(await runReviewCli(["--history"], deps)).toBe(0);
    expect(output()).toMatchObject({ ok: true, count: 1 });
    expect(output().resolutions[0]).toMatchObject({ transaction_id: id, action: "confirm" });
  });

  it("es idempotente: la segunda vez informa que ya estaba resuelta, con exit 0", async () => {
    const id = enRevision({ amount: 12.5 });
    await runReviewCli(["--confirm", String(id)], deps);

    expect(await runReviewCli(["--confirm", String(id)], deps)).toBe(0);
    expect(output()).toMatchObject({ ok: true, changed: false, reason: "already_resolved" });
  });

  it.each([
    ["id que no existe", ["--confirm", "9999"], "not_found"],
    ["--correct sin monto", ["--correct", "1"], undefined],
    ["--correct con monto no numerico", ["--correct", "1=abc"], undefined],
    ["comando desconocido", ["--borrar", "1"], undefined],
    ["id no numerico", ["--confirm", "abc"], undefined],
  ])("falla con exit 1 en %s", async (_caso, argv) => {
    enRevision({ amount: 12.5 });

    expect(await runReviewCli(argv, deps)).toBe(1);
    expect(output().ok).toBe(false);
  });

  it("el error del motor viaja tal cual en el JSON", async () => {
    expect(await runReviewCli(["--confirm", "9999"], deps)).toBe(1);
    expect(output()).toEqual({ ok: false, error: "not_found" });
  });
});
