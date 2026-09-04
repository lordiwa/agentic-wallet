/**
 * La re-ancla del saldo.
 *
 * `leerAncla` se prueba SIEMPRE (es aritmética sobre un SQLite sintético que
 * se arma acá, con montos redondos y ficticios). `reanclarSaldo` necesita una
 * base, así que se saltea anunciándose cuando no hay emulador — la misma
 * regla que `migrate-tenant.test.ts`.
 *
 * Del snapshot real no se afirma ningún monto: sólo qué tabla ganó y que la
 * fecha del ancla es la que es (CLAUDE.md regla 2).
 */
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { conectarEmulador, hayEmulador, limpiarTenant, uidDePrueba } from "../src/test-support/emulator.js";
import * as paths from "../src/ledger/paths.js";
import { leerAncla, reanclarSaldo } from "./reanclar-saldo.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "reancla-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Un SQLite mínimo: sólo las dos tablas que el script mira. */
function base(
  nombre: string,
  opciones: {
    snapshot?: string | null;
    saldos?: { fecha: string; corriente: number | null }[];
    sinTablaSaldos?: boolean;
  }
): Database.Database {
  const db = new Database(join(dir, `${nombre}.sqlite`));
  db.exec("CREATE TABLE strategy_config (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  if (opciones.sinTablaSaldos !== true) {
    db.exec(
      "CREATE TABLE saldos (fecha TEXT PRIMARY KEY, corriente REAL, flexiahorro REAL, emergencia REAL, nota TEXT)"
    );
    for (const fila of opciones.saldos ?? []) {
      db.prepare("INSERT INTO saldos (fecha, corriente) VALUES (?, ?)").run(fila.fecha, fila.corriente);
    }
  }
  if (opciones.snapshot !== undefined && opciones.snapshot !== null) {
    db.prepare("INSERT INTO strategy_config (key, value) VALUES ('balanceSnapshot', ?)").run(
      opciones.snapshot
    );
  }
  return db;
}

describe("leerAncla", () => {
  it("no devuelve nada cuando el snapshot es el default del seed", () => {
    const db = base("default", { snapshot: JSON.stringify({ amount: 0, at: "1970-01-01" }) });
    expect(leerAncla(db)).toBeNull();
    db.close();
  });

  it("no devuelve nada cuando el snapshot es el default de Firestore (at vacio)", () => {
    const db = base("vacio", { snapshot: JSON.stringify({ amount: 0, at: "" }) });
    expect(leerAncla(db)).toBeNull();
    db.close();
  });

  it("no devuelve nada cuando no hay ni snapshot ni saldos", () => {
    const db = base("nada", {});
    expect(leerAncla(db)).toBeNull();
    db.close();
  });

  it("toma el snapshot cuando es un ancla real y no hay saldos", () => {
    const db = base("snap", { snapshot: JSON.stringify({ amount: 1500, at: "2026-07-20" }) });
    expect(leerAncla(db)).toEqual({ amount: 1500, at: "2026-07-20", fuente: "strategy_config" });
    db.close();
  });

  // Un cero leido del banco es un dato, no una ausencia (CLAUDE.md regla 4):
  // sólo se descarta el cero que viene con la fecha neutra del seed.
  it("acepta un cero real, con fecha real", () => {
    const db = base("cero", { snapshot: JSON.stringify({ amount: 0, at: "2026-08-06" }) });
    expect(leerAncla(db)).toEqual({ amount: 0, at: "2026-08-06", fuente: "strategy_config" });
    db.close();
  });

  it("prefiere `saldos` al snapshot, que es lo que arregla el saldo en cero", () => {
    const db = base("prefiere", {
      snapshot: JSON.stringify({ amount: 1500, at: "2026-07-20" }),
      saldos: [{ fecha: "2026-08-06", corriente: 400 }],
    });
    expect(leerAncla(db)).toEqual({ amount: 400, at: "2026-08-06", fuente: "saldos" });
    db.close();
  });

  it("de varias filas de `saldos` toma la mas reciente", () => {
    const db = base("varias", {
      saldos: [
        { fecha: "2026-06-01", corriente: 100 },
        { fecha: "2026-08-06", corriente: 400 },
        { fecha: "2026-07-15", corriente: 250 },
      ],
    });
    expect(leerAncla(db)).toEqual({ amount: 400, at: "2026-08-06", fuente: "saldos" });
    db.close();
  });

  // Una fila que sólo trae ahorro no dice nada de la cuenta corriente: si
  // ganara por ser la más nueva, taparia una lectura buena con un hueco.
  it("saltea las filas de `saldos` sin corriente", () => {
    const db = base("sin-corriente", {
      saldos: [
        { fecha: "2026-08-06", corriente: null },
        { fecha: "2026-07-15", corriente: 250 },
      ],
    });
    expect(leerAncla(db)).toEqual({ amount: 250, at: "2026-07-15", fuente: "saldos" });
    db.close();
  });

  it("cae al snapshot si la tabla `saldos` ni existe", () => {
    const db = base("sin-tabla", {
      sinTablaSaldos: true,
      snapshot: JSON.stringify({ amount: 1500, at: "2026-07-20" }),
    });
    expect(leerAncla(db)?.fuente).toBe("strategy_config");
    db.close();
  });

  it("ignora un snapshot con fecha que no es un dia calendario", () => {
    const db = base("mala-fecha", { snapshot: JSON.stringify({ amount: 1500, at: "ayer" }) });
    expect(leerAncla(db)).toBeNull();
    db.close();
  });

  it("ignora un snapshot con JSON roto en vez de reventar", () => {
    const db = base("json-roto", { snapshot: "{no es json" });
    expect(leerAncla(db)).toBeNull();
    db.close();
  });
});

describe.skipIf(!hayEmulador)("reanclarSaldo", () => {
  const handle = hayEmulador ? conectarEmulador() : null;
  const uid = uidDePrueba("reancla");

  afterAll(async () => {
    if (handle === null) return;
    await limpiarTenant(handle.db, uid);
    await handle.cerrar();
  });

  it("escribe el ancla, no pisa el resto del perfil, y se verifica releyendo", async () => {
    if (handle === null) return;
    const ref = paths.configDoc(handle.db, uid, "strategy");
    await ref.set({
      moneda: "USD",
      colchonObjetivo: 300,
      balanceSnapshot: { amount: 0, at: "1970-01-01" },
    });

    const db = base("e2e", { saldos: [{ fecha: "2026-08-06", corriente: 400 }] });
    db.close();

    const reporte = await reanclarSaldo({
      firestore: handle.db,
      sqlitePath: join(dir, "e2e.sqlite"),
      uid,
    });

    expect(reporte).toMatchObject({
      uid,
      fuente: "saldos",
      at: "2026-08-06",
      eraElDefault: true,
      verificado: true,
      dryRun: false,
    });

    const escrito = (await ref.get()).data();
    expect(escrito?.balanceSnapshot).toEqual({ amount: 400, at: "2026-08-06" });
    // El merge: lo que no es el ancla sigue donde estaba.
    expect(escrito?.moneda).toBe("USD");
    expect(escrito?.colchonObjetivo).toBe(300);
  });

  it("con --dry-run no toca nada", async () => {
    if (handle === null) return;
    const otro = uidDePrueba("reancla-seco");
    const ref = paths.configDoc(handle.db, otro, "strategy");
    await ref.set({ balanceSnapshot: { amount: 0, at: "1970-01-01" } });

    const db = base("seco", { saldos: [{ fecha: "2026-08-06", corriente: 400 }] });
    db.close();

    const reporte = await reanclarSaldo({
      firestore: handle.db,
      sqlitePath: join(dir, "seco.sqlite"),
      uid: otro,
      dryRun: true,
    });

    expect(reporte.dryRun).toBe(true);
    expect(reporte.verificado).toBe(false);
    expect((await ref.get()).data()?.balanceSnapshot).toEqual({ amount: 0, at: "1970-01-01" });
    await limpiarTenant(handle.db, otro);
  });

  it("se niega a escribir cuando el SQLite no tiene ningun ancla real", async () => {
    if (handle === null) return;
    const db = base("sin-ancla", { snapshot: JSON.stringify({ amount: 0, at: "1970-01-01" }) });
    db.close();

    await expect(
      reanclarSaldo({
        firestore: handle.db,
        sqlitePath: join(dir, "sin-ancla.sqlite"),
        uid: uidDePrueba("reancla-vacio"),
      })
    ).rejects.toThrow(/ancla real/);
  });
});
