import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../src/db/schema.js";
import { createTenantSnapshot, fingerprintLedger } from "./tenant-snapshot.js";

let dir: string;
/** Handles que el test deja abiertos a proposito (ver `crearLedgerViejo`). */
let abiertos: Database.Database[];

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tenant-snapshot-"));
  abiertos = [];
});

afterEach(() => {
  for (const db of abiertos) db.close();
  rmSync(dir, { recursive: true, force: true });
});

/**
 * Un ledger con la forma del real: WAL activo, filas sin checkpointear y —lo
 * que importa— **sin** `classify_silenced`, que es el esquema viejo de
 * `bolsillo.sqlite` (docs/pivot-saas.md §3.8). Nombres ficticios, como manda
 * CLAUDE.md regla 2.
 */
function crearLedgerViejo(file: string, filas: number): Database.Database {
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  migrate(db);
  // Se tira la tabla que la base real no tiene, para que el test ejerza la
  // migracion de esquema de verdad y no una copia entre iguales.
  db.exec("DROP TABLE classify_silenced");
  const insert = db.prepare(
    "INSERT INTO transactions (gmail_msg_id, ts, amount, type, direction, counterparty, needs_review, raw_subject) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (let i = 0; i < filas; i += 1) {
    insert.run(
      `msg-${i}`,
      `2026-03-${String((i % 28) + 1).padStart(2, "0")}T10:00:00-05:00`,
      // Una fila en 0 y marcada para revision: cero es un monto valido y la
      // huella tiene que distinguirlo de cualquier otro (CLAUDE.md, regla 4).
      i === 0 ? 0 : i * 1.5,
      "consumo",
      "egreso",
      `Comercio Ficticio ${i % 7}`,
      i === 0 ? 1 : 0,
      `Aviso ${i}`
    );
  }
  // A proposito NO se hace checkpoint y la conexion se devuelve ABIERTA:
  // SQLite borra el `-wal` cuando se cierra la ultima conexion, asi que un
  // `close()` aca dejaria un ledger ya consolidado y el test no probaria
  // nada. El ledger real tiene su `-wal` justamente porque hay (o hubo) un
  // proceso con la base abierta. Cada test cierra el handle al final.
  abiertos.push(db);
  return db;
}

describe("createTenantSnapshot", () => {
  it("consolida el WAL: el snapshot trae las filas que un cp perderia", () => {
    const source = path.join(dir, "ledger.sqlite");
    const dest = path.join(dir, "snapshot.sqlite");
    crearLedgerViejo(source, 40);

    // La premisa del test: hay datos en el WAL, no solo en el .sqlite.
    expect(existsSync(`${source}-wal`)).toBe(true);
    expect(statSync(`${source}-wal`).size).toBeGreaterThan(0);

    const result = createTenantSnapshot({ source, dest });

    expect(result.mismatches).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.before.counts.transactions).toBe(40);
    expect(result.after.counts.transactions).toBe(40);
    expect(result.before.transactionsDigest).toBe(result.after.transactionsDigest);
  });

  // Abrir la copia con el server nuevo escribe defaults neutros donde no habia
  // nada. Que aparezca en el reporte y no como un descuadre es la diferencia
  // entre "esto lo hizo el seed" y "se perdieron filas".
  it("reporta aparte las filas que agrega el seed, y no las cuenta como descuadre", () => {
    const source = path.join(dir, "ledger.sqlite");
    const dest = path.join(dir, "snapshot.sqlite");
    crearLedgerViejo(source, 4);

    const result = createTenantSnapshot({ source, dest });

    expect(result.ok).toBe(true);
    expect(result.seeded.strategy_config).toBeGreaterThan(0);
    // El seed no inventa movimientos: el ledger sale intacto.
    expect(result.seeded.transactions).toBeUndefined();
    expect(result.afterCopy.transactionsDigest).toBe(result.after.transactionsDigest);
  });

  // Sin `--sin-esquema` el snapshot es la copia cruda: ni una fila de mas.
  it("con applySchema=false el destino es identico al origen", () => {
    const source = path.join(dir, "ledger.sqlite");
    const dest = path.join(dir, "snapshot.sqlite");
    crearLedgerViejo(source, 9);

    const result = createTenantSnapshot({ source, dest, applySchema: false });

    expect(result.mismatches).toEqual([]);
    expect(result.seeded).toEqual({});
    expect(result.tablesAdded).toEqual([]);
    expect(result.classifySilencedPresent).toBe(false);
  });

  it("aplica el esquema que falta: classify_silenced aparece en el destino", () => {
    const source = path.join(dir, "ledger.sqlite");
    const dest = path.join(dir, "snapshot.sqlite");
    crearLedgerViejo(source, 5);

    const result = createTenantSnapshot({ source, dest });

    expect(result.before.counts.classify_silenced).toBeUndefined();
    expect(result.classifySilencedPresent).toBe(true);
    expect(result.tablesAdded).toContain("classify_silenced");
    // Y la tabla nueva nace vacia: migrar esquema no inventa filas.
    expect(result.after.counts.classify_silenced).toBe(0);
  });

  it("no toca el original: mismos bytes y mismo WAL despues de correr", () => {
    const source = path.join(dir, "ledger.sqlite");
    const dest = path.join(dir, "snapshot.sqlite");
    crearLedgerViejo(source, 12);
    const antes = { db: statSync(source).size, wal: statSync(`${source}-wal`).size };

    createTenantSnapshot({ source, dest });

    expect(statSync(source).size).toBe(antes.db);
    expect(statSync(`${source}-wal`).size).toBe(antes.wal);
    // Y sigue sin la tabla nueva: la migracion ocurrio en la copia.
    const src = new Database(source, { readonly: true });
    try {
      expect(fingerprintLedger(src).counts.classify_silenced).toBeUndefined();
    } finally {
      src.close();
    }
  });

  it("el snapshot queda sin WAL colgando", () => {
    const source = path.join(dir, "ledger.sqlite");
    const dest = path.join(dir, "snapshot.sqlite");
    crearLedgerViejo(source, 8);

    const result = createTenantSnapshot({ source, dest });

    expect(result.walConsolidated).toBe(true);
    expect(existsSync(`${dest}-wal`) && statSync(`${dest}-wal`).size > 0).toBe(false);
  });

  // Pisar un snapshot anterior en silencio es de la misma familia que perder
  // el WAL: se descubre cuando ya no hay a que volver.
  it("se niega a pisar un destino que ya existe", () => {
    const source = path.join(dir, "ledger.sqlite");
    const dest = path.join(dir, "snapshot.sqlite");
    crearLedgerViejo(source, 3);
    createTenantSnapshot({ source, dest });

    expect(() => createTenantSnapshot({ source, dest })).toThrow(/ya existe/);
  });

  /**
   * `npm run tenant-snapshot` corre con el cwd en `server/`, donde hay otro
   * `bolsillo.sqlite` vacio. Anclar al cwd hacia que la herramienta reportara
   * "0 transacciones, todo OK" sobre la base equivocada — un exito falso, que
   * en una migracion es peor que un error.
   */
  it("ancla las rutas relativas a la raiz del repo, no al cwd", () => {
    const guardado = process.env.WALLET_PROJECT_DIR;
    process.env.WALLET_PROJECT_DIR = dir;
    try {
      crearLedgerViejo(path.join(dir, "ledger.sqlite"), 7);
      const result = createTenantSnapshot({ source: "ledger.sqlite", dest: "snapshot.sqlite" });
      expect(result.source).toBe(path.join(dir, "ledger.sqlite"));
      expect(result.dest).toBe(path.join(dir, "snapshot.sqlite"));
      expect(result.before.counts.transactions).toBe(7);
    } finally {
      if (guardado === undefined) delete process.env.WALLET_PROJECT_DIR;
      else process.env.WALLET_PROJECT_DIR = guardado;
    }
  });

  // El ledger real es anterior a `is_discarded` y a `account_holder`: pedirle
  // una columna que no tiene reventaba la consulta de la huella.
  it("sirve para un ledger sin las columnas aditivas del esquema nuevo", () => {
    const source = path.join(dir, "ledger.sqlite");
    const dest = path.join(dir, "snapshot.sqlite");
    const db = crearLedgerViejo(source, 5);
    db.exec("ALTER TABLE transactions DROP COLUMN is_discarded");

    const result = createTenantSnapshot({ source, dest });

    expect(result.mismatches).toEqual([]);
    expect(result.before.transactionsColumns).not.toContain("is_discarded");
    expect(result.columnsAdded).toContain("is_discarded");
    // La huella se compara sobre las columnas del origen: agregar una columna
    // no puede leerse como "cambio el contenido".
    expect(result.before.transactionsDigest).toBe(result.after.transactionsDigest);
  });

  it("falla claro si el origen no existe", () => {
    expect(() =>
      createTenantSnapshot({ source: path.join(dir, "no-esta.sqlite"), dest: path.join(dir, "x.sqlite") })
    ).toThrow(/no existe/);
  });

  it("detecta que el contenido cambio, no solo que cambio el conteo", () => {
    const source = path.join(dir, "ledger.sqlite");
    crearLedgerViejo(source, 6);
    const a = new Database(source, { readonly: true });
    const huellaOriginal = fingerprintLedger(a).transactionsDigest;
    a.close();

    // Mismo numero de filas, un monto distinto.
    const escritura = new Database(source);
    escritura.prepare("UPDATE transactions SET amount = 999 WHERE gmail_msg_id = 'msg-3'").run();
    escritura.close();

    const b = new Database(source, { readonly: true });
    try {
      const huellaNueva = fingerprintLedger(b);
      expect(huellaNueva.counts.transactions).toBe(6);
      expect(huellaNueva.transactionsDigest).not.toBe(huellaOriginal);
    } finally {
      b.close();
    }
  });
});
