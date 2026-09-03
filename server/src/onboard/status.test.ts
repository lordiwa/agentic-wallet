/**
 * Dos cosas distintas del checklist se prueban aca:
 *
 * - El paso "huso horario", que no puede darse por hecho en silencio.
 * - El paso "primer sync", el unico que puede quedar A MEDIAS: el backlog de
 *   un buzon real se drena en varias llamadas (ver sync/run-sync.ts), asi que
 *   "hay filas en el ledger" ya no alcanza para darlo por cerrado.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { insertTransaction } from "../db/repository.js";
import { startSyncProgress, advanceSyncProgress } from "../db/sync-progress.js";
import { setStrategyConfig } from "../db/strategy-config.js";
import { onboardStatus, profileConfigured, type OnboardStatus, type StepId } from "./status.js";

let db: Database.Database;
let dir: string;
let envPath: string;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  dir = mkdtempSync(path.join(tmpdir(), "wallet-onboard-status-"));
  envPath = path.join(dir, ".env");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("onboardStatus: huso horario", () => {
  // envPath apunta a un archivo que no existe: el paso "env" queda pendiente,
  // que es irrelevante para lo que se prueba aca.
  function status(env: NodeJS.ProcessEnv = {}): OnboardStatus {
    return onboardStatus({ envPath: "/no/existe/.env", env, db });
  }

  function step(env: NodeJS.ProcessEnv, id: StepId) {
    const found = status(env).steps.find((s) => s.id === id);
    if (!found) throw new Error(`no hay paso '${id}' en el checklist`);
    return found;
  }

  it("lista el huso como un paso propio del checklist", () => {
    expect(status().steps.map((s) => s.id)).toEqual(["env", "claude", "gmail", "sync", "huso", "profile"]);
  });

  // El default -5 decide que cae en "hoy" y en "este mes" en TODOS los totales.
  // Aplicarlo sin decirlo le da a alguien en Madrid o Buenos Aires cifras
  // diarias corridas sin ningun aviso.
  it("queda pendiente cuando WALLET_UTC_OFFSET_HOURS no esta seteada", () => {
    const huso = step({}, "huso");
    expect(huso.done).toBe(false);
    expect(huso.action).toContain("WALLET_UTC_OFFSET_HOURS");
    expect(huso.action).toContain("-5");
  });

  it("se da por hecho cuando el usuario la puso explicitamente", () => {
    expect(step({ WALLET_UTC_OFFSET_HOURS: "-3" }, "huso").done).toBe(true);
  });

  it("una variable vacia no cuenta como elegida", () => {
    expect(step({ WALLET_UTC_OFFSET_HOURS: "  " }, "huso").done).toBe(false);
  });

  it("el onboarding no se declara completo mientras el huso siga implicito", () => {
    expect(status().complete).toBe(false);
  });
});

describe("onboardStatus: paso sync", () => {
  function status() {
    return onboardStatus({ envPath, env: {}, db });
  }

  function syncStep() {
    return status().steps.find((s) => s.id === "sync")!;
  }

  function unaFila(id: string) {
    insertTransaction(db, {
      gmail_msg_id: id,
      ts: "2026-07-01T12:00:00.000Z",
      direction: "out",
      type: "debito",
      amount: 10,
    });
  }

  it("sin ledger, el paso esta pendiente y sin progreso que mostrar", () => {
    const step = syncStep();
    expect(step.done).toBe(false);
    expect(step.progress).toBeUndefined();
  });

  it("con backlog a medias NO da el paso por cerrado, aunque ya haya filas", () => {
    unaFila("m1");
    startSyncProgress(db, {
      sinceTs: "1970-01-01T00:00:00.000Z",
      startedAt: "2026-07-20T10:00:00.000Z",
      pendingIds: Array.from({ length: 1717 }, (_, i) => `msg-${i}`),
    });
    advanceSyncProgress(db, {
      pendingIds: Array.from({ length: 1617 }, (_, i) => `msg-${i + 100}`),
      processed: 100,
      totals: { seen: 100 },
      updatedAt: "2026-07-20T10:02:00.000Z",
    });

    const step = syncStep();
    expect(step.done).toBe(false);
    expect(step.progress).toEqual({ processed: 100, total: 1717, remaining: 1617 });
    // El texto tiene que decirle al agente que la salida es seguir llamando.
    expect(step.action).toContain("1617");
  });

  it("sin backlog pendiente y con ledger, el paso queda cerrado", () => {
    unaFila("m1");
    expect(syncStep().done).toBe(true);
    expect(syncStep().progress).toBeUndefined();
  });

  it("el paso pendiente sigue siendo `sync` mientras quede backlog", () => {
    writeFileSync(envPath, "");
    unaFila("m1");
    startSyncProgress(db, { sinceTs: "s", startedAt: "t", pendingIds: ["a", "b"] });

    const result = onboardStatus({
      envPath,
      env: {
        ANTHROPIC_API_KEY: `sk-ant-api03-${"x".repeat(90)}`,
        GMAIL_OAUTH_CLIENT_ID: "id",
        GMAIL_OAUTH_CLIENT_SECRET: "secret",
        GMAIL_OAUTH_REFRESH_TOKEN: "refresh",
      },
      db,
    });

    expect(result.complete).toBe(false);
    expect(result.next?.id).toBe("sync");
  });
});

/**
 * Wargaming ronda 4, W30. El paso del perfil cerraba con `diasPago.length > 0`,
 * así que un `--set '{"sueldo":{…,"diasPago":["15"]}}'` —un día suelto, que
 * `parseDiasPago` descarta— dejaba el onboarding **completo** sobre un
 * calendario mudo: sin `nextPayday` no hay safe-to-spend, que es la única razón
 * por la que este paso existe.
 */
describe("profileConfigured — el día de pago tiene que servirle al calendario", () => {
  it("no da el perfil por hecho con un día que el calendario no lee", () => {
    const sueldo = { fuente: "EMPRESA", cadencia: "mensual", montoEstimado: 100, diasPago: ["15"] };
    db.prepare(
      "INSERT INTO strategy_config (key, value) VALUES ('sueldo', @v) ON CONFLICT(key) DO UPDATE SET value = @v"
    ).run({ v: JSON.stringify(sueldo) });
    db.prepare(
      "INSERT INTO strategy_config (key, value) VALUES ('titular', @v) ON CONFLICT(key) DO UPDATE SET value = @v"
    ).run({ v: JSON.stringify("PERSONA EJEMPLO") });

    expect(profileConfigured(db)).toBe(false);

    setStrategyConfig(db, { sueldo: { ...sueldo, diasPago: ["15-15"] } });
    expect(profileConfigured(db)).toBe(true);
  });
});
