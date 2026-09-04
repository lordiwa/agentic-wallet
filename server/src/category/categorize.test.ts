import { describe, expect, it } from "vitest";
import { categorize, CATEGORIES } from "./categorize.js";
import type { CategorizeInput, EstablishmentRule } from "./categorize.js";
import { RESPONDABLE_CATEGORIES, UNCLASSIFIED_CATEGORIES } from "../classify/queue.js";

/**
 * A user's merchant rules, as `npm run onboard` would have written them.
 * Nothing like this ships with the repo -- the point of these cases is that
 * rule 6 works off the user's OWN table, and that with no rules at all every
 * consumo falls through to 'otros' (the last case below).
 */
const RULES: EstablishmentRule[] = [
  { category: "salud", pattern: "centro medico norte" },
  { category: "mascota", pattern: "veterinaria luna" },
  { category: "servicios", pattern: "telecom" },
];

// Regression locks (tests-after tier, TASK-024): one case per glossary rule
// (AC2) plus the 'otros' fallback (AC1). Table-driven so each row reads as
// one acceptance criterion.
const CASES: Array<{ name: string; input: CategorizeInput; expected: string }> = [
  // 1-3: type-based rules.
  { name: "retiro -> efectivo", input: { type: "retiro", counterparty: null }, expected: "efectivo" },
  {
    name: "servicio (generic combo, not Tuenti/Claro) -> servicios",
    input: { type: "servicio", counterparty: "Combo Internet Basico" },
    expected: "servicios",
  },
  { name: "recarga -> recarga", input: { type: "recarga", counterparty: "Claro" }, expected: "recarga" },

  // 4: income is not a gasto -> 'otros' (documented decision).
  { name: "sueldo (income) -> otros, not a gasto", input: { type: "sueldo", counterparty: "Acme Corp S.A." }, expected: "otros" },
  { name: "recibido (income) -> otros, not a gasto", input: { type: "recibido", counterparty: "Juan Perez" }, expected: "otros" },

  // 5: non-internal transferencia to a person.
  {
    name: "transferencia (no interna) a persona -> transferencia_persona",
    input: { type: "transferencia", counterparty: "Maria Lopez", is_internal: false },
    expected: "transferencia_persona",
  },
  {
    name: "transferencia interna -> otros (excluded from gasto)",
    input: { type: "transferencia", counterparty: "PEREZ GOMEZ ANA MARIA", is_internal: true },
    expected: "otros",
  },
  {
    name: "transferencia sin contraparte -> otros (can't name a person)",
    input: { type: "transferencia", counterparty: null, is_internal: false },
    expected: "otros",
  },

  // 6: user-configured establishment match on counterparty (debito/credito consumo).
  {
    name: "salud: a configured clinic pattern",
    input: { type: "debito", counterparty: "Centro Medico Norte" },
    expected: "salud",
  },
  {
    name: "salud: match is accent/case-insensitive",
    input: { type: "credito", counterparty: "CENTRO MÉDICO NORTE suc. 4" },
    expected: "salud",
  },
  { name: "mascota: a configured vet pattern", input: { type: "debito", counterparty: "VETERINARIA LUNA" }, expected: "mascota" },
  { name: "servicios establishment: a configured carrier pattern", input: { type: "debito", counterparty: "Telecom SA" }, expected: "servicios" },

  // 7: unrecognized establishment / type -> 'otros' fallback (AC1, never invents).
  { name: "unknown establishment (debito) -> otros", input: { type: "debito", counterparty: "COMISARIATO EXPRESS" }, expected: "otros" },
  { name: "unknown type -> otros", input: { type: "unknown_future_type", counterparty: null }, expected: "otros" },
  { name: "no counterparty, no type match -> otros", input: { type: "credito", counterparty: null }, expected: "otros" },
];

describe("categorize", () => {
  for (const { name, input, expected } of CASES) {
    it(name, () => {
      expect(categorize(input, RULES)).toBe(expected);
    });
  }

  it("is pure: same input always yields the same output", () => {
    const input: CategorizeInput = { type: "debito", counterparty: "VETERINARIA LUNA" };
    expect(categorize(input, RULES)).toBe(categorize({ ...input }, RULES));
  });

  it("a type rule wins over a matching establishment rule (type checked first)", () => {
    // A "compra minutos" row sets counterparty to the carrier on a
    // recarga-type row; it must categorize as recarga, not servicios, even
    // though the carrier also matches a configured servicios pattern.
    expect(categorize({ type: "recarga", counterparty: "Telecom SA" }, RULES)).toBe("recarga");
  });

  /**
   * En Ecuador (y en cualquier plaza donde el pago inmediato entre cuentas
   * reemplazo a la tarjeta) el comercio cobra por transferencia: la clinica,
   * la veterinaria y el restaurante llegan como `type: 'transferencia'` con
   * el nombre del comercio en `counterparty`. Con el fallback estructural
   * corriendo primero, TODOS caian en 'transferencia_persona' y ninguna regla
   * del usuario podia rescatarlos -- el dashboard mostraba una sola montania
   * de "transferencias a personas" y salud/mascota/comida en cero.
   *
   * De ahi la prioridad: una regla es el usuario afirmando "este nombre es un
   * comercio y es de esta categoria". El fallback por `type` solo sabe "es una
   * transferencia con contraparte", que es estrictamente menos informacion.
   */
  describe("una regla del usuario gana sobre el fallback de transferencia", () => {
    it("transferencia a un comercio con regla -> la categoria de la regla", () => {
      expect(
        categorize({ type: "transferencia", counterparty: "CENTRO MEDICO NORTE", is_internal: false }, RULES)
      ).toBe("salud");
      expect(
        categorize({ type: "transferencia", counterparty: "Veterinaria Luna", is_internal: false }, RULES)
      ).toBe("mascota");
    });

    it("transferencia a una persona sin regla -> sigue siendo transferencia_persona", () => {
      expect(
        categorize({ type: "transferencia", counterparty: "Maria Lopez", is_internal: false }, RULES)
      ).toBe("transferencia_persona");
    });

    it("transferencia sin contraparte -> sigue siendo otros", () => {
      expect(categorize({ type: "transferencia", counterparty: null, is_internal: false }, RULES)).toBe("otros");
    });

    /**
     * `is_internal` sigue ganando: no es un fallback grueso sino un hecho
     * sobre las cuentas (plata que no salio del bolsillo). Una regla de
     * comercio no puede convertir un movimiento entre cuentas propias en
     * gasto.
     */
    it("transferencia interna -> otros, aunque la contraparte matchee una regla", () => {
      expect(
        categorize({ type: "transferencia", counterparty: "Centro Medico Norte", is_internal: true }, RULES)
      ).toBe("otros");
    });
  });

  /**
   * The boilerplate guarantee: with no rules configured, no consumo is ever
   * assigned a category inherited from whoever the engine was built for.
   */
  it("falls back to 'otros' for every consumo when no rules are configured", () => {
    expect(categorize({ type: "debito", counterparty: "Centro Medico Norte" })).toBe("otros");
    expect(categorize({ type: "credito", counterparty: "VETERINARIA LUNA" })).toBe("otros");
    // Type-driven rules still apply without any merchant rules at all.
    expect(categorize({ type: "retiro", counterparty: null })).toBe("efectivo");
  });
});

/**
 * Las seis categorías que se sumaron al glosario después del MVP. Lo que estos
 * casos fijan no es que existan —eso lo diría el compilador— sino la propiedad
 * que hace que sumarlas sea seguro: **una categoría nueva no reclasifica nada
 * por sí sola.** El glosario es más largo, pero `categorize` no cambió de
 * opinión sobre ninguna entrada que ya sabía contestar.
 */
describe("las categorias que se sumaron al glosario", () => {
  const NUEVAS = ["vivienda", "entretenimiento", "limpieza", "deuda", "prestamo", "regalo"] as const;

  it("estan en el glosario y se pueden responder (no son fallbacks)", () => {
    for (const categoria of NUEVAS) {
      expect(CATEGORIES).toContain(categoria);
      expect(RESPONDABLE_CATEGORIES).toContain(categoria);
      expect(UNCLASSIFIED_CATEGORIES.has(categoria)).toBe(false);
    }
  });

  it("solo las alcanza una regla del usuario: sin regla nada cae ahi solo", () => {
    // Ninguna es alcanzable por `type`, que es como debe ser: adivinar que un
    // consumo es 'vivienda' por su tipo seria inventar el dato.
    for (const type of ["debito", "credito", "transferencia", "servicio", "recarga", "retiro"]) {
      expect(NUEVAS).not.toContain(categorize({ type, counterparty: "Comercio Ficticio" }) as never);
    }
    expect(categorize({ type: "debito", counterparty: "Arriendo Ficticio" }, [
      { category: "vivienda", pattern: "arriendo ficticio" },
    ])).toBe("vivienda");
  });

  it("no mueven ninguna clasificacion vieja: las reglas ya escritas siguen dando lo mismo", () => {
    for (const { input, expected } of CASES) {
      expect(categorize(input, RULES)).toBe(expected);
    }
  });
});
