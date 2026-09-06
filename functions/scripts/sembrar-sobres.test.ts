/**
 * La siembra de sobres desde `saldos`.
 *
 * `leerSobresDeSaldos` se prueba SIEMPRE (es aritmética sobre un SQLite
 * sintético que se arma acá, con montos redondos y ficticios). `sembrarSobres`
 * necesita una base, así que se saltea anunciándose cuando no hay emulador —
 * la misma regla que `reanclar-saldo.test.ts`.
 *
 * Del snapshot real no se afirma ningún monto (CLAUDE.md regla 2).
 */
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { conectarEmulador, hayEmulador, limpiarTenant, uidDePrueba } from "../src/test-support/emulator.js";
import * as paths from "../src/ledger/paths.js";
import { leerSobresDeSaldos, sembrarSobres } from "./sembrar-sobres.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sembrar-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface Fila {
  fecha: string;
  corriente?: number | null;
  flexiahorro?: number | null;
  emergencia?: number | null;
}

/** Un SQLite mínimo: sólo la tabla que el script mira. */
function base(nombre: string, opciones: { saldos?: Fila[]; sinTablaSaldos?: boolean }): string {
  const ruta = join(dir, `${nombre}.sqlite`);
  const db = new Database(ruta);
  if (opciones.sinTablaSaldos !== true) {
    db.exec(
      "CREATE TABLE saldos (fecha TEXT PRIMARY KEY, corriente REAL, flexiahorro REAL, emergencia REAL, nota TEXT)"
    );
    for (const fila of opciones.saldos ?? []) {
      db.prepare(
        "INSERT INTO saldos (fecha, corriente, flexiahorro, emergencia) VALUES (?, ?, ?, ?)"
      ).run(fila.fecha, fila.corriente ?? null, fila.flexiahorro ?? null, fila.emergencia ?? null);
    }
  }
  db.close();
  return ruta;
}

function leer(nombre: string, opciones: { saldos?: Fila[]; sinTablaSaldos?: boolean }) {
  const db = new Database(base(nombre, opciones), { readonly: true });
  try {
    return leerSobresDeSaldos(db);
  } finally {
    db.close();
  }
}

describe("leerSobresDeSaldos", () => {
  it("no devuelve nada cuando la tabla `saldos` ni existe", () => {
    expect(leer("sin-tabla", { sinTablaSaldos: true })).toBeNull();
  });

  it("no devuelve nada cuando `saldos` esta vacia", () => {
    expect(leer("vacia", { saldos: [] })).toBeNull();
  });

  it("mapea las tres columnas a sus sobres, y `emergencia` al colchon", () => {
    const lectura = leer("tres", {
      saldos: [{ fecha: "2026-08-06", corriente: 400, flexiahorro: 1100, emergencia: 150 }],
    });
    expect(lectura?.fecha).toBe("2026-08-06");
    expect(lectura?.sobres).toEqual([
      { id: "corriente", nombre: "Corriente", montoCents: 40000, sistema: false },
      { id: "flexiahorro", nombre: "FlexiAhorro", montoCents: 110000, sistema: false },
      // La razón de todo el cuidado: el sobre de emergencia ES el colchón, y es
      // el único que el safe-to-spend descuenta.
      { id: "colchon", nombre: "Emergencia", montoCents: 15000, sistema: true },
    ]);
  });

  it("convierte a centavos enteros sin arrastrar el flotante", () => {
    const lectura = leer("centavos", {
      saldos: [{ fecha: "2026-08-06", corriente: 407.04, flexiahorro: 1105.73 }],
    });
    expect(lectura?.sobres.map((s) => s.montoCents)).toEqual([40704, 110573]);
  });

  // Un `null` es "no sé cuánto hay" y no un cero (CLAUDE.md regla 4): sembrar
  // un cero ahí seria afirmar que el banco decia cero.
  it("saltea las columnas en NULL en vez de sembrarlas en cero", () => {
    const lectura = leer("null", {
      saldos: [{ fecha: "2026-08-06", corriente: 400, flexiahorro: null, emergencia: null }],
    });
    expect(lectura?.sobres.map((s) => s.id)).toEqual(["corriente"]);
  });

  it("siembra un cero explicito, que si es una lectura", () => {
    const lectura = leer("cero", { saldos: [{ fecha: "2026-08-06", emergencia: 0 }] });
    expect(lectura?.sobres).toEqual([
      { id: "colchon", nombre: "Emergencia", montoCents: 0, sistema: true },
    ]);
  });

  it("de varias filas toma la mas reciente", () => {
    const lectura = leer("varias", {
      saldos: [
        { fecha: "2026-06-01", corriente: 100 },
        { fecha: "2026-08-06", corriente: 400 },
        { fecha: "2026-07-15", corriente: 250 },
      ],
    });
    expect(lectura?.fecha).toBe("2026-08-06");
    expect(lectura?.sobres[0]?.montoCents).toBe(40000);
  });

  // Una fila con las tres columnas vacías no dice nada, y si ganara por ser la
  // más nueva taparia una lectura buena con un hueco.
  it("saltea las filas enteramente vacias", () => {
    const lectura = leer("hueco", {
      saldos: [
        { fecha: "2026-08-06" },
        { fecha: "2026-07-15", corriente: 250 },
      ],
    });
    expect(lectura?.fecha).toBe("2026-07-15");
  });

  it("ignora una fecha que no es un dia calendario", () => {
    expect(leer("mala-fecha", { saldos: [{ fecha: "ayer", corriente: 400 }] })).toBeNull();
  });

  it("ignora un monto negativo: un sobre en negativo no es un sobre", () => {
    const lectura = leer("negativo", {
      saldos: [{ fecha: "2026-08-06", corriente: -50, flexiahorro: 1100 }],
    });
    expect(lectura?.sobres.map((s) => s.id)).toEqual(["flexiahorro"]);
  });
});

describe.skipIf(!hayEmulador)("sembrarSobres", () => {
  const handle = hayEmulador ? conectarEmulador() : null;
  const uid = uidDePrueba("sembrar");

  afterAll(async () => {
    if (handle === null) return;
    await limpiarTenant(handle.db, uid);
    await handle.cerrar();
  });

  it("actualiza el colchon que ya existia sin pisar sus otros campos, y crea los que faltan", async () => {
    if (handle === null) return;
    const col = paths.savings(handle.db, uid);
    // El colchón tal como lo dejó la migración: existe, vacío, con su rastro.
    await col.doc("colchon").set({
      label: "colchon",
      reservedCents: 0,
      targetCents: 0,
      legacyId: 1,
      updatedAt: "2026-09-01 21:32:27",
    });

    const ruta = base("e2e", {
      saldos: [{ fecha: "2026-08-06", corriente: 400, flexiahorro: 1100, emergencia: 150 }],
    });
    const reporte = await sembrarSobres({ firestore: handle.db, sqlitePath: ruta, uid });

    expect(reporte).toMatchObject({ uid, fecha: "2026-08-06", colchonMovido: true, dryRun: false });
    expect(reporte.sobres).toEqual([
      { id: "corriente", existia: false, sistema: false, verificado: true },
      { id: "flexiahorro", existia: false, sistema: false, verificado: true },
      { id: "colchon", existia: true, sistema: true, verificado: true },
    ]);

    const colchon = (await col.doc("colchon").get()).data();
    expect(colchon?.reservedCents).toBe(15000);
    // El merge: lo que no es el monto sigue donde estaba. `targetCents` en
    // particular NO se toca — el objetivo del colchón vive en config/strategy.
    expect(colchon?.label).toBe("colchon");
    expect(colchon?.targetCents).toBe(0);
    expect(colchon?.legacyId).toBe(1);

    const flexi = (await col.doc("flexiahorro").get()).data();
    expect(flexi?.reservedCents).toBe(110000);
    expect(flexi?.label).toBe("FlexiAhorro");
    // Un sobre nuevo nace sin objetivo: `saldos` dice cuánto hay, no cuánto se
    // queria, y un objetivo igual al monto seria uno ya cumplido que nadie fijó.
    expect(flexi?.targetCents).toBeUndefined();
    expect(typeof flexi?.createdAt).toBe("string");
  });

  it("no pisa el nombre de un sobre que el usuario renombro", async () => {
    if (handle === null) return;
    const otro = uidDePrueba("sembrar-nombre");
    const col = paths.savings(handle.db, otro);
    await col.doc("flexiahorro").set({ label: "Mi ahorro", reservedCents: 0 });

    const ruta = base("renombrado", { saldos: [{ fecha: "2026-08-06", flexiahorro: 1100 }] });
    await sembrarSobres({ firestore: handle.db, sqlitePath: ruta, uid: otro });

    const doc = (await col.doc("flexiahorro").get()).data();
    expect(doc?.reservedCents).toBe(110000);
    expect(doc?.label).toBe("Mi ahorro");
    await limpiarTenant(handle.db, otro);
  });

  it("con --dry-run no toca nada", async () => {
    if (handle === null) return;
    const otro = uidDePrueba("sembrar-seco");
    const ruta = base("seco", { saldos: [{ fecha: "2026-08-06", corriente: 400 }] });

    const reporte = await sembrarSobres({
      firestore: handle.db,
      sqlitePath: ruta,
      uid: otro,
      dryRun: true,
    });

    expect(reporte.dryRun).toBe(true);
    expect(reporte.sobres).toEqual([
      { id: "corriente", existia: false, sistema: false, verificado: false },
    ]);
    expect((await paths.savings(handle.db, otro).get()).empty).toBe(true);
  });

  it("se niega a escribir cuando no hay ningun monto real", async () => {
    if (handle === null) return;
    const ruta = base("nada", { saldos: [{ fecha: "2026-08-06" }] });
    await expect(
      sembrarSobres({ firestore: handle.db, sqlitePath: ruta, uid: uidDePrueba("sembrar-nada") })
    ).rejects.toThrow(/no se escribe nada/i);
  });
});
