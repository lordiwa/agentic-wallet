import { describe, expect, it } from "vitest";
import {
  fromCents,
  isCountable,
  localDayKey,
  localMonthKey,
  localMonthRange,
  toCents,
  toTransactionDoc,
  type RawTransaction,
} from "./derive.js";

function fila(overrides: Partial<RawTransaction> = {}): RawTransaction & { id: number } {
  return {
    id: 1,
    gmail_msg_id: "msg-1",
    gmail_thread_id: null,
    ts: "2026-05-15T14:00:00.000Z",
    direction: "out",
    type: "debito",
    amount: 12.34,
    currency: "USD",
    counterparty: "Tienda Ejemplo",
    account: null,
    account_holder: null,
    category: null,
    raw_subject: null,
    is_reversed: 0,
    is_internal: 0,
    needs_review: 0,
    is_discarded: 0,
    source: "parser",
    created_at: "2026-05-15T14:05:00.000Z",
    ...overrides,
  };
}

describe("isCountable", () => {
  it("acepta la fila limpia", () => {
    expect(isCountable(fila())).toBe(true);
  });

  it.each([
    ["is_internal", { is_internal: 1 }],
    ["is_reversed", { is_reversed: 1 }],
    ["needs_review", { needs_review: 1 }],
    ["is_discarded", { is_discarded: 1 }],
  ] as const)("excluye por %s", (_nombre, override) => {
    expect(isCountable(fila(override))).toBe(false);
  });

  it("excluye la fila de auditoria del reverso", () => {
    expect(isCountable(fila({ type: "reverso", direction: "in" }))).toBe(false);
  });
});

describe("dia y mes locales", () => {
  it("una compra de la noche cae en el dia local, no en el UTC del dia siguiente", () => {
    // 2026-06-01T02:00Z con offset -5 son las 21:00 del 31 de mayo.
    expect(localDayKey("2026-06-01T02:00:00.000Z", -5)).toBe("2026-05-31");
    expect(localMonthKey("2026-06-01T02:00:00.000Z", -5)).toBe("2026-05");
  });

  it("el mismo instante con offset 0 cae en junio", () => {
    expect(localMonthKey("2026-06-01T02:00:00.000Z", 0)).toBe("2026-06");
  });

  it("un ts que no parsea da null en vez de tirar", () => {
    expect(localDayKey("no es una fecha", -5)).toBeNull();
    expect(localMonthKey("", -5)).toBeNull();
  });

  it("localMonthRange devuelve medianoche local del 1 al 1 siguiente", () => {
    const { from, to } = localMonthRange(new Date("2026-05-15T12:00:00.000Z"), -5);
    expect(from.toISOString()).toBe("2026-05-01T05:00:00.000Z");
    expect(to.toISOString()).toBe("2026-06-01T05:00:00.000Z");
  });

  it("cruza el fin de año sin romperse", () => {
    const { from, to } = localMonthRange(new Date("2026-12-20T12:00:00.000Z"), -5);
    expect(from.toISOString()).toBe("2026-12-01T05:00:00.000Z");
    expect(to.toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });
});

describe("centavos", () => {
  it("no arrastra el error del float", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(fromCents(toCents(19.99))).toBe(19.99);
  });

  it("cero es un monto, no una ausencia", () => {
    // CLAUDE.md regla 4: `amount: 0` nunca significa "no pude leerlo".
    expect(toTransactionDoc(fila({ amount: 0 })).amountCents).toBe(0);
    expect(toTransactionDoc(fila({ amount: 0 })).countable).toBe(true);
  });
});

describe("toTransactionDoc", () => {
  it("deriva pattern, mes, categoria base y elegibilidad", () => {
    const doc = toTransactionDoc(fila({ counterparty: "  FARMACÍA Sur  " }), -5);
    expect(doc.pattern).toBe("farmacia sur");
    expect(doc.month).toBe("2026-05");
    expect(doc.baseCategory).toBe("otros");
    expect(doc.queueEligible).toBe(true);
  });

  it("una fila sin contraparte no es elegible: no hay pregunta que hacer", () => {
    const doc = toTransactionDoc(fila({ counterparty: null }), -5);
    expect(doc.pattern).toBeNull();
    expect(doc.queueEligible).toBe(false);
  });

  it("un servicio ya tiene categoria: no entra a la cola", () => {
    const doc = toTransactionDoc(fila({ type: "servicio" }), -5);
    expect(doc.baseCategory).toBe("servicios");
    expect(doc.queueEligible).toBe(false);
  });

  it("un ingreso no entra a la cola aunque su categoria base sea 'otros'", () => {
    const doc = toTransactionDoc(fila({ type: "sueldo", direction: "in" }), -5);
    expect(doc.baseCategory).toBe("otros");
    expect(doc.queueEligible).toBe(false);
  });

  it("una fila en revision no cuenta ni entra a la cola", () => {
    const doc = toTransactionDoc(fila({ needs_review: 1 }), -5);
    expect(doc.countable).toBe(false);
    expect(doc.queueEligible).toBe(false);
  });

  it("no inventa: lo que el SQLite no trae, el documento lo lleva en null", () => {
    const doc = toTransactionDoc(fila({ account: null, account_holder: null, category: null }), -5);
    expect(doc.account).toBeNull();
    expect(doc.accountHolder).toBeNull();
    expect(doc.storedCategory).toBeNull();
  });
});
