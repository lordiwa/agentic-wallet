/**
 * El registro de un movimiento dictado.
 *
 * `planRegistro` se prueba SIEMPRE: es validación y aritmética de fechas sobre
 * datos ficticios, sin base. `registrarMovimiento` necesita Firestore, así que
 * se saltea anunciándose cuando no hay emulador — la misma regla que
 * `sembrar-sobres.test.ts`.
 *
 * Lo que estos tests protegen no es "escribe un documento": es que la puerta
 * manual no pueda aflojar la invariante. Que un monto ausente no se vuelva
 * cero, que cero sí se pueda registrar, que una contraparte vacía no cree una
 * fila que la cola nunca podrá preguntar, y que un gasto sin categoría dictada
 * caiga en la cola en vez de quedarse en "otros" para siempre.
 */
import { afterAll, describe, expect, it } from "vitest";
import { conectarEmulador, hayEmulador, limpiarTenant, uidDePrueba } from "../src/test-support/emulator.js";
import { localDayKey } from "../src/ledger/derive.js";
import * as paths from "../src/ledger/paths.js";
import {
  idDeMovimiento,
  instanteDelDia,
  planRegistro,
  registrarMovimiento,
  type MovimientoDictado,
} from "./registrar-movimiento.js";

/** Una dictada válida, con montos redondos y una contraparte ficticia. */
function dictada(over: Partial<MovimientoDictado> = {}): MovimientoDictado {
  return {
    fecha: "2026-03-15",
    monto: 40,
    direccion: "out",
    tipo: "debito",
    contraparte: "COMERCIO DE PRUEBA",
    moneda: "USD",
    ...over,
  };
}

describe("planRegistro", () => {
  it("arma la fila con el monto dictado y sin nada inventado", () => {
    const plan = planRegistro(dictada(), -5, new Date("2026-03-15T20:00:00.000Z"));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    expect(plan.fila.amount).toBe(40);
    expect(plan.fila.counterparty).toBe("COMERCIO DE PRUEBA");
    // No hubo correo, no hubo cuenta, no hubo categoría histórica.
    expect(plan.fila.gmail_thread_id).toBeNull();
    expect(plan.fila.account).toBeNull();
    expect(plan.fila.account_holder).toBeNull();
    expect(plan.fila.category).toBeNull();
    // La persona afirmó el monto: es `human`, no `deterministic`, y no hay nada
    // que revisar.
    expect(plan.fila.source).toBe("human");
    expect(plan.fila.needs_review).toBe(0);
  });

  it("cero es un monto y se registra; ausente o no numérico no", () => {
    expect(planRegistro(dictada({ monto: 0 }), -5).ok).toBe(true);
    for (const monto of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const plan = planRegistro(dictada({ monto }), -5);
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.error).toBe("monto_invalido");
    }
  });

  it("rechaza una contraparte que normaliza a vacío", () => {
    // Sin contraparte, `pattern` queda en null y la cola no puede preguntar.
    for (const contraparte of ["", "   "]) {
      const plan = planRegistro(dictada({ contraparte }), -5);
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.error).toBe("contraparte_vacia");
    }
  });

  it("rechaza un tipo que el parser no produce", () => {
    // "consumo" suena a tipo y no existe: caería en el `default` de categorize.
    const plan = planRegistro(dictada({ tipo: "consumo" }), -5);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.error).toBe("tipo_invalido");
  });

  it("rechaza fecha, dirección y categoría fuera de forma", () => {
    const casos: [Partial<MovimientoDictado>, string][] = [
      [{ fecha: "15/03/2026" }, "fecha_invalida"],
      [{ fecha: "2026-13-40" }, "fecha_invalida"],
      [{ direccion: "salida" as never }, "direccion_invalida"],
      [{ categoria: "medicina" as never }, "categoria_invalida"],
      [{ moneda: " " }, "moneda_invalida"],
    ];
    for (const [over, error] of casos) {
      const plan = planRegistro(dictada(over), -5);
      expect(plan.ok).toBe(false);
      if (!plan.ok) expect(plan.error).toBe(error);
    }
  });

  it("el día local del ts es el dictado, en cualquier huso", () => {
    // El mediodía local es lo que hace que ningún offset lo corra de día.
    for (const offset of [-12, -5, 0, 5, 14]) {
      const ts = instanteDelDia("2026-03-15", offset);
      expect(localDayKey(ts, offset)).toBe("2026-03-15");
    }
  });

  it("el id es estable para la misma dictada y distinto para otra", () => {
    expect(idDeMovimiento(dictada())).toBe(idDeMovimiento(dictada()));
    expect(idDeMovimiento(dictada({ monto: 41 }))).not.toBe(idDeMovimiento(dictada()));
    expect(idDeMovimiento(dictada({ contraparte: "OTRO" }))).not.toBe(idDeMovimiento(dictada()));
    expect(idDeMovimiento(dictada())).toMatch(/^manual-2026-03-15-[0-9a-f]{12}$/);
  });

  it("un `--id` explícito gana, para dos movimientos idénticos el mismo día", () => {
    const plan = planRegistro(dictada({ id: "manual-a-mano" }), -5);
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.id).toBe("manual-a-mano");
  });
});

describe.skipIf(!hayEmulador)("registrarMovimiento (emulador)", () => {
  // El `describe` se evalúa aunque esté salteado: la conexión sólo se abre si
  // de verdad hay emulador (mismo patrón que `sembrar-sobres.test.ts`).
  const handle = hayEmulador ? conectarEmulador() : null;
  const db = () => handle!.db;
  const uid = uidDePrueba("registrar");

  afterAll(async () => {
    if (handle === null) return;
    await limpiarTenant(handle.db, uid);
    await handle.cerrar();
  });

  it("escribe la fila, la relee, y la deja lista para la cola", async () => {
    const reporte = await registrarMovimiento({
      firestore: db(),
      uid,
      movimiento: dictada({ contraparte: "PRESTAMO (PENDIENTE)", tipo: "transferencia", monto: 150 }),
      now: new Date("2026-03-15T20:00:00.000Z"),
    });

    expect(reporte.yaEstaba).toBe(false);
    expect(reporte.verificado).toBe(true);
    expect(reporte.amountCents).toBe(15_000);
    // Cuenta en los totales y la cola puede preguntar por ella: son las dos
    // cosas que un movimiento dictado tiene que conseguir.
    expect(reporte.derivados).toMatchObject({
      countable: true,
      queueEligible: true,
      day: "2026-03-15",
      month: "2026-03",
    });
    expect(reporte.clasificacion).toBeNull();
  });

  it("volver a dictar lo mismo no duplica ni pisa", async () => {
    const movimiento = dictada({ contraparte: "REPETIDO", monto: 12 });
    const primero = await registrarMovimiento({ firestore: db(), uid, movimiento });
    const segundo = await registrarMovimiento({ firestore: db(), uid, movimiento });

    expect(primero.yaEstaba).toBe(false);
    expect(segundo.yaEstaba).toBe(true);
    expect(segundo.id).toBe(primero.id);
    const snap = await paths.transactions(db(), uid).where("counterparty", "==", "REPETIDO").get();
    expect(snap.size).toBe(1);
  });

  it("`--dry-run` no escribe nada", async () => {
    const movimiento = dictada({ contraparte: "EN SECO", monto: 9 });
    const reporte = await registrarMovimiento({ firestore: db(), uid, movimiento, dryRun: true });
    expect(reporte.dryRun).toBe(true);
    const snap = await paths.transactions(db(), uid).doc(reporte.id).get();
    expect(snap.exists).toBe(false);
  });

  it("con categoría dictada, la escribe el escritor del motor y sale de la cola", async () => {
    const reporte = await registrarMovimiento({
      firestore: db(),
      uid,
      movimiento: dictada({ contraparte: "MEDICINA", monto: 40, categoria: "salud" }),
    });

    expect(reporte.verificado).toBe(true);
    expect(reporte.clasificacion).toMatchObject({
      ok: true,
      pattern: "medicina",
      category: "salud",
      reclassified: 1,
    });
    // La regla la escribió `classifyCounterparty`, con el patrón derivado de la
    // contraparte real del ledger.
    const regla = await paths.rules(db(), uid).doc("medicina").get();
    expect(regla.data()).toMatchObject({ pattern: "medicina", category: "salud" });
  });

  it("un uid que no puede ser un segmento de path no escribe nada", async () => {
    await expect(
      registrarMovimiento({ firestore: db(), uid: "a/b", movimiento: dictada() })
    ).rejects.toThrow("uid invalido");
  });
});
