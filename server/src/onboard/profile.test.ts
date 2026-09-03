import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import { getStrategyConfig, setStrategyConfig } from "../db/strategy-config.js";
import { parseDiasPago } from "../strategy/calendar.js";
import { CLAVES_DEL_PERFIL, normalizarDiasPago, readProfile, writeProfile } from "./profile.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

afterEach(() => {
  db.close();
});

/** Todo `strategy_config` tal como está guardado, para poder afirmar qué NO se
 * tocó. */
function configCrudo(): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM strategy_config").all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

describe("normalizarDiasPago", () => {
  it("convierte un día suelto en la ventana que el calendario sabe leer", () => {
    expect(normalizarDiasPago(["15", "30"])).toEqual(["15-15", "30-30"]);
  });

  // `<=5` es la ventana 1..5 para el calendario, así que va primera.
  it("deja pasar una ventana ya escrita, y el '<=' del motor", () => {
    expect(normalizarDiasPago(["18-20", "<=5"])).toEqual(["<=5", "18-20"]);
  });

  it("ordena y deduplica: dos veces el mismo día es un día", () => {
    expect(normalizarDiasPago(["30", "15", "15-15"])).toEqual(["15-15", "30-30"]);
  });

  it("todo lo que devuelve lo parsea el calendario — eso es lo que la hace útil", () => {
    const dias = normalizarDiasPago([" 15 ", "28-30", "<=3"]);

    expect(dias).not.toBeNull();
    expect(parseDiasPago(dias as string[])).toHaveLength(3);
  });

  // La trampa que motiva esta función: `parseDiasPago` descarta EN SILENCIO lo
  // que no parsea. Un "15" escrito a mano se guardaba, se leía, y dejaba el
  // calendario mudo sin un solo error.
  it("rechaza lo que el calendario descartaría en silencio", () => {
    expect(normalizarDiasPago(["quincena"])).toBeNull();
    expect(normalizarDiasPago(["15 y 30"])).toBeNull();
    expect(normalizarDiasPago(["15-"])).toBeNull();
  });

  it("rechaza un día que no existe en ningún mes", () => {
    expect(normalizarDiasPago(["0"])).toBeNull();
    expect(normalizarDiasPago(["32"])).toBeNull();
    expect(normalizarDiasPago(["20-45"])).toBeNull();
  });

  it("rechaza una ventana al revés", () => {
    expect(normalizarDiasPago(["30-15"])).toBeNull();
  });

  it("rechaza la lista vacía: borrar el día de pago no es configurarlo", () => {
    expect(normalizarDiasPago([])).toBeNull();
  });
});

describe("readProfile", () => {
  it("un perfil sin configurar no dice cero: dice que no está fijado (R25)", () => {
    const perfil = readProfile(db);

    expect(perfil.colchonObjetivo).toBe(0);
    expect(perfil.colchonFijado).toBe(false);
    expect(perfil.diasPago).toEqual([]);
    expect(perfil.diaDePagoFijado).toBe(false);
  });

  it("lee los dos campos una vez escritos", () => {
    writeProfile(db, { diasPago: ["15", "30"], colchonObjetivo: 500 });

    expect(readProfile(db)).toMatchObject({
      diasPago: ["15-15", "30-30"],
      diaDePagoFijado: true,
      colchonObjetivo: 500,
      colchonFijado: true,
    });
  });
});

describe("writeProfile — exactamente dos campos (criterio 6)", () => {
  it("escribe el colchón y los días de pago, y nada más", () => {
    setStrategyConfig(db, {
      moneda: "USD",
      titular: "PEREZ GOMEZ ANA MARIA",
      sueldo: { fuente: "EMPRESA FICTICIA SA", cadencia: "quincenal", montoEstimado: 1200, diasPago: [] },
      balanceSnapshot: { amount: 1840.25, at: "2026-07-01" },
    });
    const antes = configCrudo();

    const resultado = writeProfile(db, { diasPago: ["15", "30"], colchonObjetivo: 500 });

    expect(resultado.ok).toBe(true);
    expect(CLAVES_DEL_PERFIL).toEqual(["diasPago", "colchonObjetivo"]);

    const despues = configCrudo();
    const cambiadas = Object.keys(despues).filter((key) => despues[key] !== antes[key]);
    // `diasPago` vive DENTRO de `sueldo`, así que las filas tocadas son dos.
    expect(cambiadas.sort()).toEqual(["colchonObjetivo", "sueldo"]);
    expect(despues.moneda).toBe(antes.moneda);
    expect(despues.titular).toBe(antes.titular);
    expect(despues.balanceSnapshot).toBe(antes.balanceSnapshot);
  });

  it("cambiar el día de pago no toca el sueldo leído del historial", () => {
    setStrategyConfig(db, {
      sueldo: { fuente: "EMPRESA FICTICIA SA", cadencia: "quincenal", montoEstimado: 1200, diasPago: [] },
    });

    writeProfile(db, { diasPago: ["15"] });

    expect(getStrategyConfig(db).sueldo).toEqual({
      fuente: "EMPRESA FICTICIA SA",
      cadencia: "quincenal",
      montoEstimado: 1200,
      diasPago: ["15-15"],
    });
  });

  it("es parcial: mandar sólo el colchón deja el día de pago como estaba", () => {
    writeProfile(db, { diasPago: ["15"] });
    writeProfile(db, { colchonObjetivo: 800 });

    expect(readProfile(db)).toMatchObject({ diasPago: ["15-15"], colchonObjetivo: 800 });
  });

  it("un objetivo en cero se guarda como cero, y sigue siendo SIN FIJAR (R25)", () => {
    writeProfile(db, { colchonObjetivo: 0 });

    expect(readProfile(db)).toMatchObject({ colchonObjetivo: 0, colchonFijado: false });
  });
});

describe("writeProfile — lo que rechaza", () => {
  it("rechaza un día de pago que el calendario no sabría leer, sin escribir nada", () => {
    const antes = configCrudo();

    const resultado = writeProfile(db, { diasPago: ["quincena"] });

    expect(resultado).toEqual({ ok: false, error: "dias_pago_invalidos" });
    expect(configCrudo()).toEqual(antes);
  });

  it("rechaza un colchón negativo", () => {
    expect(writeProfile(db, { colchonObjetivo: -1 })).toEqual({ ok: false, error: "colchon_invalido" });
  });

  it("rechaza un colchón que no es un número finito", () => {
    expect(writeProfile(db, { colchonObjetivo: Number.NaN })).toEqual({ ok: false, error: "colchon_invalido" });
  });

  it("un patch vacío no es una escritura: no hay nada que confirmar", () => {
    expect(writeProfile(db, {})).toEqual({ ok: false, error: "sin_campos" });
  });

  // El patch entero se valida ANTES de escribir: media escritura dejaría un
  // perfil que el usuario nunca confirmó.
  it("si un campo es inválido, el otro tampoco se escribe", () => {
    const resultado = writeProfile(db, { diasPago: ["quincena"], colchonObjetivo: 500 });

    expect(resultado.ok).toBe(false);
    expect(readProfile(db).colchonObjetivo).toBe(0);
  });
});
