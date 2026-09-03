/**
 * La migración, contra el emulador de Firestore.
 *
 * Dos suites, y la diferencia entre ellas importa:
 *
 * 1. Sobre un SQLite **sintético** que se construye acá con el esquema real del
 *    motor. Corre siempre, en cualquier máquina y en CI. Nombres ficticios y
 *    montos redondos (CLAUDE.md regla 2).
 * 2. Sobre el snapshot **real** del tenant 1, si está presente en la máquina.
 *    Se saltea con un aviso donde no está. De este sólo se afirman CONTEOS —
 *    ni un nombre, ni un monto, ni una fila entra a este archivo.
 *
 * Ninguna de las dos toca producción: el script se niega a correr si
 * `FIRESTORE_EMULATOR_HOST` no está puesto.
 */
import Database from "better-sqlite3";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../server/src/db/schema.js";
import { conectarEmulador, hayEmulador, limpiarTenant, uidDePrueba } from "../src/test-support/emulator.js";
import * as paths from "../src/ledger/paths.js";
import { encodeDocId, migrateTenant, readStrategyConfig } from "./migrate-tenant.js";

/** El snapshot VACUUM del tenant 1. Fuera del repo a propósito. */
const SNAPSHOT_REAL = "/opt/data/backups/wallet-tenant1-vacuum.sqlite";

describe("encodeDocId", () => {
  it("deja legible lo que ya es un id valido", () => {
    expect(encodeDocId("farmacia sur")).toBe("farmacia sur");
  });

  it("escapa la barra, que partiria el path", () => {
    expect(encodeDocId("a/b")).toBe("a%2Fb");
  });

  it("escapa los segmentos reservados de Firestore", () => {
    expect(encodeDocId(".")).toBe("%2E");
    expect(encodeDocId("..")).toBe("%2E%2E");
    expect(encodeDocId("__proto__")).toBe("x__proto__");
  });

  it("corta a 1500 bytes", () => {
    expect(Buffer.byteLength(encodeDocId("x".repeat(2000)), "utf8")).toBeLessThanOrEqual(1500);
  });
});

/** Arma un SQLite con el esquema REAL del motor y datos ficticios. */
function sqliteSintetico(dir: string): string {
  const ruta = join(dir, "sintetico.sqlite");
  const db = new Database(ruta);
  migrate(db);

  const insertar = db.prepare(
    `INSERT INTO transactions (gmail_msg_id, ts, direction, type, amount, currency, counterparty,
       is_reversed, is_internal, needs_review, is_discarded, source, created_at)
     VALUES (@gmail_msg_id, @ts, @direction, @type, @amount, 'USD', @counterparty,
       @is_reversed, @is_internal, @needs_review, @is_discarded, 'parser', '2026-05-01T00:00:00.000Z')`
  );
  const base = {
    ts: "2026-05-15T14:00:00.000Z",
    direction: "out",
    type: "debito",
    amount: 10,
    counterparty: "Comercio Ficticio",
    is_reversed: 0,
    is_internal: 0,
    needs_review: 0,
    is_discarded: 0,
  };
  for (let i = 1; i <= 7; i += 1) {
    insertar.run({ ...base, gmail_msg_id: `msg-${i}`, amount: i * 10 });
  }
  insertar.run({ ...base, gmail_msg_id: "msg-rev", needs_review: 1, amount: 99 });

  db.prepare("INSERT INTO category_rules (pattern, category, created_at) VALUES (?, ?, ?)").run(
    "comercio",
    "comida",
    "2026-05-01T00:00:00.000Z"
  );
  db.prepare("INSERT INTO classify_silenced (pattern, counterparty, created_at) VALUES (?, ?, ?)").run(
    "persona ficticia",
    "Persona Ficticia",
    "2026-05-02T00:00:00.000Z"
  );
  db.prepare(
    "INSERT INTO statements (card_mask, issue_date, balance, min_payment, due_date, gmail_msg_id) VALUES (?, ?, ?, ?, ?, ?)"
  ).run("1234", "2026-05-05", 250, 25, "2026-05-25", "stmt-1");
  db.prepare("INSERT INTO savings (label, target, reserved, updated_at) VALUES (?, ?, ?, ?)").run(
    "colchon",
    500,
    120,
    "2026-05-01"
  );
  db.prepare("INSERT INTO debts (person, amount, kind, status, note) VALUES (?, ?, ?, ?, ?)").run(
    "Persona Ficticia",
    40,
    "personal",
    "pending",
    null
  );
  db.prepare(
    `INSERT INTO review_resolutions (transaction_id, gmail_msg_id, action, previous_amount, new_amount, note, resolved_by, resolved_at)
     VALUES (1, 'msg-1', 'confirm', 10, NULL, NULL, 'humano', '2026-05-06T00:00:00.000Z')`
  ).run();
  db.prepare("INSERT INTO strategy_config (key, value) VALUES (?, ?)").run("moneda", JSON.stringify("USD"));
  db.prepare("INSERT INTO strategy_config (key, value) VALUES (?, ?)").run("colchonObjetivo", "500");
  db.prepare("INSERT INTO strategy_config (key, value) VALUES (?, ?)").run(
    "balanceSnapshot",
    JSON.stringify({ amount: 1000, at: "2026-05-01" })
  );
  db.prepare("INSERT INTO sync_state (id, last_sync_ts, last_history) VALUES (1, ?, NULL)").run(
    "2026-05-20T00:00:00.000Z"
  );
  db.close();
  return ruta;
}

describe("readStrategyConfig", () => {
  it("reconstruye el objeto tipado y no pierde el resto por una clave corrupta", () => {
    const dir = mkdtempSync(join(tmpdir(), "wallet-mig-"));
    try {
      const ruta = join(dir, "cfg.sqlite");
      const db = new Database(ruta);
      migrate(db);
      db.prepare("INSERT INTO strategy_config (key, value) VALUES (?, ?)").run("moneda", JSON.stringify("EUR"));
      db.prepare("INSERT INTO strategy_config (key, value) VALUES (?, ?)").run("titular", "{ esto no es json");
      const config = readStrategyConfig(db);
      db.close();
      expect(config.moneda).toBe("EUR");
      expect(config.titular).toBe("{ esto no es json");
      // Lo que la tabla no trae sale del default, no de una invencion.
      expect(config.colchonObjetivo).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(!hayEmulador)("migrateTenant sobre un ledger sintetico", () => {
  const handle = hayEmulador ? conectarEmulador() : null;
  const uid = uidDePrueba("mig");
  let dir = "";
  let ruta = "";

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "wallet-mig-"));
    ruta = sqliteSintetico(dir);
  });

  afterAll(async () => {
    rmSync(dir, { recursive: true, force: true });
    if (!handle) return;
    await limpiarTenant(handle.db, uid);
    await handle.cerrar();
  });

  it("--dry-run no escribe nada", async () => {
    const reporte = await migrateTenant({ firestore: handle!.db, sqlitePath: ruta, uid, dryRun: true });
    expect(reporte.dryRun).toBe(true);
    expect(reporte.leido.transactions).toBe(8);
    const cuenta = await paths.transactions(handle!.db, uid).count().get();
    expect(cuenta.data().count).toBe(0);
  });

  it("migra todas las colecciones y verifica contando contra Firestore", async () => {
    const reporte = await migrateTenant({ firestore: handle!.db, sqlitePath: ruta, uid });
    expect(reporte.discrepancias).toEqual([]);
    expect(reporte.verificado).toEqual({
      transactions: 8,
      rules: 1,
      silenced: 1,
      statements: 1,
      savings: 1,
      debts: 1,
      reviews: 1,
    });
  });

  it("el id del documento es el gmail_msg_id, y por eso migrar dos veces no duplica", async () => {
    await migrateTenant({ firestore: handle!.db, sqlitePath: ruta, uid });
    const reporte = await migrateTenant({ firestore: handle!.db, sqlitePath: ruta, uid });
    expect(reporte.verificado.transactions).toBe(8);
    expect(reporte.discrepancias).toEqual([]);
  });

  it("los derivados quedan escritos: la fila en revision no es contable", async () => {
    await migrateTenant({ firestore: handle!.db, sqlitePath: ruta, uid });
    const enRevision = await paths.transactions(handle!.db, uid).doc("msg-rev").get();
    expect(enRevision.data()).toMatchObject({ countable: false, needsReview: true, queueEligible: false });
    const normal = await paths.transactions(handle!.db, uid).doc("msg-1").get();
    expect(normal.data()).toMatchObject({ countable: true, month: "2026-05", pattern: "comercio ficticio" });
  });

  it("los montos viajan en centavos enteros", async () => {
    await migrateTenant({ firestore: handle!.db, sqlitePath: ruta, uid });
    const doc = await paths.transactions(handle!.db, uid).doc("msg-3").get();
    expect(doc.data()!.amountCents).toBe(3000);
    const colchon = await paths.savings(handle!.db, uid).doc("colchon").get();
    expect(colchon.data()!.reservedCents).toBe(12_000);
  });

  it("la config del tenant queda bajo config/strategy, no suelta en el usuario", async () => {
    await migrateTenant({ firestore: handle!.db, sqlitePath: ruta, uid });
    const config = await paths.configDoc(handle!.db, uid, "strategy").get();
    expect(config.data()).toMatchObject({ moneda: "USD", colchonObjetivo: 500 });
    const sync = await paths.configDoc(handle!.db, uid, "sync").get();
    expect(sync.data()!.lastSyncTs).toBe("2026-05-20T00:00:00.000Z");
  });

  it("rechaza un uid que no puede ser un segmento de path", async () => {
    await expect(
      migrateTenant({ firestore: handle!.db, sqlitePath: ruta, uid: "otro/tenant" })
    ).rejects.toThrow(/uid invalido/);
  });
});

/**
 * El tenant 1 de verdad. Sólo conteos, y sólo si el snapshot está en la
 * máquina. El número que importa: 1159 transacciones.
 */
const haySnapshot = existsSync(SNAPSHOT_REAL);
describe.skipIf(!hayEmulador || !haySnapshot)("migrateTenant sobre el snapshot real del tenant 1", () => {
  const handle = hayEmulador && haySnapshot ? conectarEmulador() : null;
  const uid = uidDePrueba("tenant1");

  afterAll(async () => {
    if (!handle) return;
    await limpiarTenant(handle.db, uid);
    await handle.cerrar();
  });

  it("importa 1159 transacciones y cuadra en todas las colecciones", async () => {
    const reporte = await migrateTenant({ firestore: handle!.db, sqlitePath: SNAPSHOT_REAL, uid });
    expect(reporte.discrepancias).toEqual([]);
    expect(reporte.verificado.transactions).toBe(1159);
    expect(reporte.verificado.rules).toBe(36);
    expect(reporte.verificado.reviews).toBe(50);
    expect(reporte.verificado.statements).toBe(5);
  }, 180_000);

  it("los derivados cubren el ledger entero: ninguna fila queda sin mes", async () => {
    const sinMes = await paths.transactions(handle!.db, uid).where("month", "==", null).count().get();
    expect(sinMes.data().count).toBe(0);
  }, 60_000);

  it("la consulta del gasto del mes responde con el indice que se declaro", async () => {
    // Si faltara el indice compuesto (countable, direction, month) el emulador
    // igual responde, pero produccion tira FAILED_PRECONDITION. Lo que este
    // test prueba es que la consulta esta bien escrita y devuelve algo.
    const snap = await paths
      .transactions(handle!.db, uid)
      .where("countable", "==", true)
      .where("direction", "==", "out")
      .where("month", "==", "2026-07")
      .count()
      .get();
    expect(snap.data().count).toBeGreaterThan(0);
  }, 60_000);
});
