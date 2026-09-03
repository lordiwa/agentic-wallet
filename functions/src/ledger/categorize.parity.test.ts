/**
 * La copia de `categorize` que vive en `functions/` no puede divergir de la del
 * motor. Este test es el único mecanismo que lo garantiza: importa las DOS y
 * las compara sobre una matriz que cubre todas las ramas de la tabla de reglas.
 *
 * Si alguien toca una sola de las dos, esto se pone rojo. Ese es todo el punto.
 */
import { describe, expect, it } from "vitest";
import {
  categorize as categorizeMotor,
  toRulePattern as toRulePatternMotor,
  CATEGORIES as CATEGORIES_MOTOR,
  type EstablishmentRule as ReglaMotor,
} from "../../../server/src/category/categorize.js";
import { categorize, toRulePattern, CATEGORIES } from "./categorize.js";

const TIPOS = [
  "debito",
  "credito",
  "transferencia",
  "servicio",
  "recarga",
  "retiro",
  "sueldo",
  "recibido",
  "reverso",
  "tipo_desconocido",
];

const CONTRAPARTES = [
  null,
  "",
  "   ",
  "Tienda Ejemplo",
  "FARMACÍA Sur",
  "farmacia sur",
  "Clínica Norte",
  "Transporte Público",
];

const REGLAS: ReglaMotor[] = [
  { pattern: "farmacia", category: "salud" },
  { pattern: "transporte", category: "transporte" },
  { pattern: "", category: "comida" },
];

describe("paridad con el categorize del motor", () => {
  it("el glosario de categorias es identico", () => {
    expect([...CATEGORIES]).toEqual([...CATEGORIES_MOTOR]);
  });

  it("da el mismo resultado en toda la matriz tipo x contraparte x interno x reglas", () => {
    let combinaciones = 0;
    for (const type of TIPOS) {
      for (const counterparty of CONTRAPARTES) {
        for (const is_internal of [true, false]) {
          for (const reglas of [[], REGLAS]) {
            const entrada = { type, counterparty, is_internal };
            expect(categorize(entrada, reglas)).toBe(categorizeMotor(entrada, reglas));
            combinaciones += 1;
          }
        }
      }
    }
    // Que el bucle efectivamente haya corrido: un test que no compara nada
    // tambien pasa.
    expect(combinaciones).toBe(TIPOS.length * CONTRAPARTES.length * 2 * 2);
  });

  it("toRulePattern normaliza igual en las dos copias", () => {
    for (const texto of ["FARMACÍA Sur", "  Clínica  ", "", "ÑOÑO", "Café"]) {
      expect(toRulePattern(texto)).toBe(toRulePatternMotor(texto));
    }
  });
});
