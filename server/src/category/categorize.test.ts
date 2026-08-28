import { describe, expect, it } from "vitest";
import { categorize } from "./categorize.js";
import type { CategorizeInput, EstablishmentRule } from "./categorize.js";

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
