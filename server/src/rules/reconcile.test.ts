import { describe, expect, it } from "vitest";
import {
  applyReversals,
  dedupeRetiros,
  markInternalTransfers,
  reconcile,
  type ReconcilableTransaction,
  type ReversoCandidate,
} from "./reconcile.js";

const TITULAR = "PEREZ GOMEZ ANA MARIA";

function consumo(overrides: Partial<ReconcilableTransaction> = {}): ReconcilableTransaction {
  return {
    kind: "transaction",
    type: "debito",
    direction: "out",
    amount: 9.42,
    currency: "USD",
    counterparty: "COMISARIATO EXPRESS",
    account: "XXXXXX20924",
    raw_subject: "Consumo tarjeta de débito por USD 9.42",
    needs_review: false,
    gmail_msg_id: "msg-consumo-1",
    ts: "2026-07-01T15:00:00Z",
    ...overrides,
  };
}

function reverso(overrides: Partial<ReversoCandidate> = {}): ReversoCandidate {
  return {
    raw_subject: "Notificación Reverso Consumo Tarjeta de Débito Produbanco",
    amount: 9.42,
    account: "XXXXXX20924",
    ts: "2026-07-01T15:30:00Z",
    gmail_msg_id: "msg-reverso-1",
    ...overrides,
  };
}

function retiro(overrides: Partial<ReconcilableTransaction> = {}): ReconcilableTransaction {
  return {
    kind: "transaction",
    type: "retiro",
    direction: "out",
    amount: 20.0,
    currency: "USD",
    counterparty: null,
    account: "XXXXXX20924",
    raw_subject: "Retiro sin tarjeta de débito Produbanco en cajero automático",
    needs_review: false,
    gmail_msg_id: "msg-retiro-cajero",
    ts: "2026-07-01T10:00:00Z",
    ...overrides,
  };
}

function transferencia(overrides: Partial<ReconcilableTransaction> = {}): ReconcilableTransaction {
  return {
    kind: "transaction",
    type: "transferencia",
    direction: "out",
    amount: 30.0,
    currency: "USD",
    counterparty: "Carlos Andres Molina Vera",
    account: null,
    raw_subject: "Transferencia enviada por $30.00 desde Produbanco",
    needs_review: false,
    gmail_msg_id: "msg-transfer-1",
    ts: "2026-07-01T10:00:00Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Rule 1: reversos (spec 5.3.1 / AC1, AC5)
// ---------------------------------------------------------------------------

describe("applyReversals", () => {
  it("matches a reverso to its consumo by amount + account + same-day, marks is_reversed, keeps the reverso auditable (not summed)", () => {
    const txs = [consumo()];
    const reversos = [reverso()];

    const result = applyReversals(txs, reversos);

    expect(result.transactions[0].is_reversed).toBe(true);
    expect(result.reversalsApplied).toHaveLength(1);
    expect(result.reversalsApplied[0].reverso).toBe(reversos[0]);
    expect(result.reversalsApplied[0].consumo.gmail_msg_id).toBe("msg-consumo-1");
    expect(result.ambiguous).toHaveLength(0);
  });

  it("does not mutate the input transactions array in place", () => {
    const txs = [consumo()];
    applyReversals(txs, [reverso()]);
    expect(txs[0].is_reversed).toBeUndefined();
  });

  it("matches within a few hours across a calendar-day boundary (cercania temporal)", () => {
    const txs = [consumo({ ts: "2026-07-01T23:50:00Z" })];
    const reversos = [reverso({ ts: "2026-07-02T01:30:00Z" })];

    const result = applyReversals(txs, reversos);

    expect(result.transactions[0].is_reversed).toBe(true);
    expect(result.reversalsApplied).toHaveLength(1);
  });

  it("does not match a consumo far outside the temporal window on a different day", () => {
    const txs = [consumo({ ts: "2026-07-01T10:00:00Z" })];
    const reversos = [reverso({ ts: "2026-07-03T10:00:00Z" })];

    const result = applyReversals(txs, reversos);

    expect(result.transactions[0].is_reversed).toBeFalsy();
    expect(result.reversalsApplied).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
  });

  it("does not match when the account differs", () => {
    const txs = [consumo({ account: "XXXXXX99999" })];
    const result = applyReversals(txs, [reverso({ account: "XXXXXX20924" })]);

    expect(result.transactions[0].is_reversed).toBeFalsy();
    expect(result.reversalsApplied).toHaveLength(0);
  });

  it("does not match when the amount differs", () => {
    const txs = [consumo({ amount: 9.43 })];
    const result = applyReversals(txs, [reverso({ amount: 9.42 })]);

    expect(result.transactions[0].is_reversed).toBeFalsy();
    expect(result.reversalsApplied).toHaveLength(0);
  });

  it("compares amounts cents-safe, tolerating float drift", () => {
    const txs = [consumo({ amount: 0.1 + 0.2 })]; // 0.30000000000000004
    const result = applyReversals(txs, [reverso({ amount: 0.3 })]);

    expect(result.transactions[0].is_reversed).toBe(true);
  });

  it("AC5: two identical same-day consumos matching one reverso -> needs_review (ambiguous), neither is blindly matched", () => {
    const txs = [
      consumo({ gmail_msg_id: "msg-consumo-a", ts: "2026-07-01T10:00:00Z" }),
      consumo({ gmail_msg_id: "msg-consumo-b", ts: "2026-07-01T11:00:00Z" }),
    ];
    const reversos = [reverso()];

    const result = applyReversals(txs, reversos);

    expect(result.ambiguous).toEqual([reversos[0]]);
    expect(result.reversalsApplied).toHaveLength(0);
    expect(result.transactions.every((tx) => !tx.is_reversed)).toBe(true);
    // MEDIUM-1: the ambiguity must land on the real candidate rows too, not
    // just live in the separate `ambiguous` array.
    expect(result.transactions.every((tx) => tx.needs_review)).toBe(true);
  });

  it("a consumo already claimed by one reverso is not available to a second reverso, which is reported unmatched", () => {
    const txs = [consumo()];
    const reversos = [reverso({ gmail_msg_id: "r1" }), reverso({ gmail_msg_id: "r2" })];

    const result = applyReversals(txs, reversos);

    expect(result.reversalsApplied).toHaveLength(1);
    expect(result.reversalsApplied[0].reverso.gmail_msg_id).toBe("r1");
    expect(result.ambiguous).toHaveLength(0); // r2 simply finds no candidate, it's not "ambiguous"
    expect(result.unmatched.map((r) => r.gmail_msg_id)).toEqual(["r2"]);
  });

  it("ignores non-debito transactions as reversal candidates", () => {
    const txs = [consumo({ type: "servicio" })];
    const result = applyReversals(txs, [reverso()]);

    expect(result.reversalsApplied).toHaveLength(0);
    expect(result.transactions[0].is_reversed).toBeFalsy();
  });

  it("MEDIUM-2: a reverso with no matching consumo is reported in unmatched, not silently dropped", () => {
    const txs = [consumo({ amount: 5.0 })]; // amount doesn't match, no candidate
    const reversos = [reverso()];

    const result = applyReversals(txs, reversos);

    expect(result.unmatched).toEqual([reversos[0]]);
    expect(result.reversalsApplied).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
  });

  it("LOW-1: an invalid consumo ts does not throw, is never matched, and is flagged needs_review", () => {
    const txs = [consumo({ ts: "not-a-date" })];

    expect(() => applyReversals(txs, [reverso()])).not.toThrow();
    const result = applyReversals(txs, [reverso()]);

    expect(result.transactions[0].is_reversed).toBeFalsy();
    expect(result.transactions[0].needs_review).toBe(true);
    expect(result.unmatched.map((r) => r.gmail_msg_id)).toEqual(["msg-reverso-1"]);
  });

  it("LOW-1: an invalid reverso ts does not throw and is reported unmatched instead of guessed", () => {
    const txs = [consumo()];
    const reversos = [reverso({ ts: "not-a-date" })];

    expect(() => applyReversals(txs, reversos)).not.toThrow();
    const result = applyReversals(txs, reversos);

    expect(result.unmatched).toHaveLength(1);
    expect(result.reversalsApplied).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// El apareo cuando falta la cuenta (paso 1 de docs/investigacion-riesgos.md).
//
// `account` no llega siempre ni llega en los dos lados: hay correos de consumo
// que no traen "Cuenta débito", correos de reverso que tampoco (el cuerpo real
// de TASK-041 es uno), y todo el historial sincronizado antes del arreglo del
// parser lo tiene en NULL. Tratar ese `null` como si fuera un valor rompe el
// apareo en las dos direcciones a la vez: dos desconocidos se daban por
// iguales (el eje desaparecía y quedaba monto+día), y un conocido contra un
// desconocido se daba por distinto (el reverso no apareaba nada y su consumo
// seguía sumando como gasto).
//
// La regla que fijan estos tests: `null` es "no lo sé" — compatible con todo,
// evidencia de nada. Nunca se casa el reverso equivocado; si la evidencia no
// alcanza para elegir, decide un humano.
// ---------------------------------------------------------------------------

describe("applyReversals cuando falta la cuenta", () => {
  it("aparea el consumo sin cuenta con un reverso que sí la trae, si es el único candidato", () => {
    const txs = [consumo({ account: null })];

    const result = applyReversals(txs, [reverso({ account: "XXXXXX20924" })]);

    expect(result.transactions[0].is_reversed).toBe(true);
    expect(result.reversalsApplied).toHaveLength(1);
    expect(result.unmatched).toHaveLength(0);
  });

  it("aparea el consumo con cuenta contra un reverso que no la trae, si es el único candidato", () => {
    const txs = [consumo({ account: "XXXXXX20924" })];

    const result = applyReversals(txs, [reverso({ account: null })]);

    expect(result.transactions[0].is_reversed).toBe(true);
    expect(result.reversalsApplied).toHaveLength(1);
  });

  it("dos cuentas conocidas y distintas siguen sin cruzarse", () => {
    const txs = [consumo({ account: "XXXXXX99999" })];

    const result = applyReversals(txs, [reverso({ account: "XXXXXX20924" })]);

    expect(result.transactions[0].is_reversed).toBeFalsy();
    expect(result.unmatched).toHaveLength(1);
    expect(result.ambiguous).toHaveLength(0);
  });

  it("dos consumos del mismo monto y día sin cuenta: ambiguo, ninguno se casa a ciegas", () => {
    const txs = [
      consumo({ gmail_msg_id: "msg-a", account: null, counterparty: null, ts: "2026-07-01T10:00:00Z" }),
      consumo({ gmail_msg_id: "msg-b", account: null, counterparty: null, ts: "2026-07-01T11:00:00Z" }),
    ];

    const result = applyReversals(txs, [reverso({ account: null, counterparty: null })]);

    expect(result.reversalsApplied).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.transactions.every((tx) => !tx.is_reversed)).toBe(true);
    expect(result.transactions.every((tx) => tx.needs_review)).toBe(true);
  });

  it("entre un candidato que corrobora la cuenta y otro que no la trae, gana el que la corrobora", () => {
    const txs = [
      consumo({ gmail_msg_id: "msg-con-cuenta", account: "XXXXXX20924", ts: "2026-07-01T10:00:00Z" }),
      consumo({ gmail_msg_id: "msg-sin-cuenta", account: null, ts: "2026-07-01T11:00:00Z" }),
    ];

    const result = applyReversals(txs, [reverso({ account: "XXXXXX20924" })]);

    expect(result.reversalsApplied.map((m) => m.consumo.gmail_msg_id)).toEqual(["msg-con-cuenta"]);
    expect(result.ambiguous).toHaveLength(0);
    // El candidato descartado no es sospechoso de nada: una bandera no se
    // saca nunca, así que sólo se marca a quien de verdad compite.
    expect(result.transactions.find((tx) => tx.gmail_msg_id === "msg-sin-cuenta")?.needs_review).toBe(false);
  });

  it("el establecimiento desempata cuando no se conoce ninguna cuenta", () => {
    const txs = [
      consumo({ gmail_msg_id: "msg-tienda", account: null, counterparty: "TIENDA EJEMPLO" }),
      consumo({
        gmail_msg_id: "msg-otro",
        account: null,
        counterparty: "OTRO COMERCIO",
        ts: "2026-07-01T11:00:00Z",
      }),
    ];

    const result = applyReversals(txs, [reverso({ account: null, counterparty: "Tienda Ejemplo" })]);

    expect(result.reversalsApplied.map((m) => m.consumo.gmail_msg_id)).toEqual(["msg-tienda"]);
    expect(result.transactions.find((tx) => tx.gmail_msg_id === "msg-otro")?.needs_review).toBe(false);
  });

  it("mismo establecimiento en los dos candidatos: sigue siendo ambiguo", () => {
    const txs = [
      consumo({ gmail_msg_id: "msg-a", account: null, counterparty: "TIENDA EJEMPLO" }),
      consumo({
        gmail_msg_id: "msg-b",
        account: null,
        counterparty: "TIENDA EJEMPLO",
        ts: "2026-07-01T11:00:00Z",
      }),
    ];

    const result = applyReversals(txs, [reverso({ account: null, counterparty: "TIENDA EJEMPLO" })]);

    expect(result.reversalsApplied).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.transactions.every((tx) => tx.needs_review)).toBe(true);
  });

  it("sólo marca a los candidatos empatados en la cima, no a todo el que coincida en monto y día", () => {
    const txs = [
      consumo({ gmail_msg_id: "msg-a", account: null, counterparty: "TIENDA EJEMPLO" }),
      consumo({
        gmail_msg_id: "msg-b",
        account: null,
        counterparty: "TIENDA EJEMPLO",
        ts: "2026-07-01T11:00:00Z",
      }),
      consumo({
        gmail_msg_id: "msg-c",
        account: null,
        counterparty: "OTRO COMERCIO",
        ts: "2026-07-01T12:00:00Z",
      }),
    ];

    const result = applyReversals(txs, [reverso({ account: null, counterparty: "TIENDA EJEMPLO" })]);

    expect(result.ambiguous).toHaveLength(1);
    expect(result.transactions.find((tx) => tx.gmail_msg_id === "msg-a")?.needs_review).toBe(true);
    expect(result.transactions.find((tx) => tx.gmail_msg_id === "msg-b")?.needs_review).toBe(true);
    expect(result.transactions.find((tx) => tx.gmail_msg_id === "msg-c")?.needs_review).toBe(false);
  });

  it("un establecimiento distinto no descarta al único candidato", () => {
    // El nombre del comercio llega recortado, con sufijos de sucursal o
    // directamente vacío según el correo. Sirve para elegir ENTRE candidatos,
    // nunca para descartar al único que hay: descartarlo dejaría el consumo
    // revertido sumando como gasto.
    const txs = [consumo({ account: null, counterparty: "TIENDA EJEMPLO SUCURSAL NORTE" })];

    const result = applyReversals(txs, [reverso({ account: null, counterparty: "TIENDA EJEMPLO" })]);

    expect(result.transactions[0].is_reversed).toBe(true);
    expect(result.reversalsApplied).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Rule 2: retiro dedup (spec 5.3.2 / AC2)
// ---------------------------------------------------------------------------

describe("dedupeRetiros", () => {
  it("collapses a same-amount, same-day retiro pair to the 'en cajero' canonical record", () => {
    const appOrder = retiro({
      gmail_msg_id: "msg-retiro-orden",
      raw_subject: "Retiro de Efectivo sin Tarjeta (orden) Produbanco App Móvil",
      ts: "2026-07-01T09:58:00Z",
    });
    const cajero = retiro({
      gmail_msg_id: "msg-retiro-cajero",
      raw_subject: "Retiro sin tarjeta de débito Produbanco en cajero automático",
      ts: "2026-07-01T10:00:00Z",
    });

    const result = dedupeRetiros([appOrder, cajero]);

    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].gmail_msg_id).toBe("msg-retiro-cajero");
    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].gmail_msg_id).toBe("msg-retiro-orden");
  });

  it("leaves a lone retiro untouched", () => {
    const txs = [retiro()];
    const result = dedupeRetiros(txs);

    expect(result.transactions).toHaveLength(1);
    expect(result.removed).toHaveLength(0);
  });

  it("does not collapse retiros on different days or with different amounts", () => {
    const txs = [
      retiro({ gmail_msg_id: "a", ts: "2026-07-01T10:00:00Z", amount: 20 }),
      retiro({ gmail_msg_id: "b", ts: "2026-07-02T10:00:00Z", amount: 20 }),
      retiro({ gmail_msg_id: "c", ts: "2026-07-01T10:00:00Z", amount: 40 }),
    ];
    const result = dedupeRetiros(txs);

    expect(result.transactions).toHaveLength(3);
    expect(result.removed).toHaveLength(0);
  });

  it("leaves non-retiro transactions untouched", () => {
    const txs = [consumo(), transferencia()];
    const result = dedupeRetiros(txs);

    expect(result.transactions).toHaveLength(2);
    expect(result.removed).toHaveLength(0);
  });

  it("HIGH-1 regression: two genuine 'en cajero' retiros of the same amount on the same day both survive (never collapsed), flagged for review instead", () => {
    const a = retiro({ gmail_msg_id: "cajero-a", ts: "2026-07-01T10:00:00Z" });
    const b = retiro({ gmail_msg_id: "cajero-b", ts: "2026-07-01T16:00:00Z" });

    const result = dedupeRetiros([a, b]);

    const ids = result.transactions.map((tx) => tx.gmail_msg_id);
    expect(ids).toContain("cajero-a");
    expect(ids).toContain("cajero-b");
    expect(result.transactions).toHaveLength(2);
    expect(result.removed).toHaveLength(0);
    expect(result.transactions.every((tx) => tx.needs_review)).toBe(true);
  });

  it("does not collapse a group with more than one 'en cajero' record alongside an 'orden' record — flags all instead of guessing", () => {
    const orden = retiro({
      gmail_msg_id: "orden",
      raw_subject: "Retiro de Efectivo sin Tarjeta (orden) Produbanco App Móvil",
      ts: "2026-07-01T09:00:00Z",
    });
    const cajeroA = retiro({ gmail_msg_id: "cajero-a", ts: "2026-07-01T10:00:00Z" });
    const cajeroB = retiro({ gmail_msg_id: "cajero-b", ts: "2026-07-01T16:00:00Z" });

    const result = dedupeRetiros([orden, cajeroA, cajeroB]);

    expect(result.transactions).toHaveLength(3);
    expect(result.removed).toHaveLength(0);
    expect(result.transactions.every((tx) => tx.needs_review)).toBe(true);
  });

  it("LOW-1: an invalid ts does not throw, is excluded from grouping, and is flagged needs_review", () => {
    const bad = retiro({ gmail_msg_id: "bad-ts", ts: "not-a-date" });
    const good = retiro({ gmail_msg_id: "good-ts", ts: "2026-07-01T10:00:00Z" });

    expect(() => dedupeRetiros([bad, good])).not.toThrow();
    const result = dedupeRetiros([bad, good]);

    expect(result.transactions.map((tx) => tx.gmail_msg_id).sort()).toEqual(["bad-ts", "good-ts"]);
    const flagged = result.transactions.find((tx) => tx.gmail_msg_id === "bad-ts");
    expect(flagged?.needs_review).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rule 3: transferencia a si mismo (spec 5.3.3 / AC3)
// ---------------------------------------------------------------------------

describe("markInternalTransfers", () => {
  it("marks is_internal when the counterparty is an exact match for the titular", () => {
    const txs = [transferencia({ counterparty: TITULAR })];
    const [result] = markInternalTransfers(txs, { titular: TITULAR });

    expect(result.is_internal).toBe(true);
  });

  it("is tolerant of case, accents, and extra whitespace", () => {
    const txs = [transferencia({ counterparty: "pérez   gómez  ana maria" })];
    const [result] = markInternalTransfers(txs, { titular: TITULAR });

    expect(result.is_internal).toBe(true);
  });

  it("does not mark a transfer to a third party", () => {
    const txs = [transferencia({ counterparty: "Carlos Andres Molina Vera" })];
    const [result] = markInternalTransfers(txs, { titular: TITULAR });

    expect(result.is_internal).toBeFalsy();
  });

  // El banco no escribe el nombre en un orden estable, y el titular del perfil
  // se guarda como lo escribio el usuario. Comparar los strings tal cual
  // dejaba sin marcar la mayoria de las internas reales.
  it.each([
    ["orden invertido", "ANA MARIA PEREZ GOMEZ"],
    ["orden invertido y un apellido de menos", "ANA MARIA PEREZ"],
    ["con el banco destino anotado entre parentesis", "ANA MARIA PEREZ GOMEZ (Otro Banco)"],
  ])("marks the same person written %s", (_caso, counterparty) => {
    const txs = [transferencia({ counterparty })];
    const [result] = markInternalTransfers(txs, { titular: TITULAR });

    expect(result.is_internal).toBe(true);
  });

  // El contraejemplo que fija el umbral: un familiar comparte apellidos con el
  // titular y sus transferencias SI son gasto. Marcarlas de mas las borraria
  // de los totales.
  it.each([
    ["un pariente con los mismos apellidos", "JORGE LUIS PEREZ GOMEZ"],
    ["alguien que comparte solo el nombre de pila", "ANA MARIA TORRES CEVALLOS"],
  ])("does not mark %s", (_caso, counterparty) => {
    const txs = [transferencia({ counterparty })];
    const [result] = markInternalTransfers(txs, { titular: TITULAR });

    expect(result.is_internal).toBeFalsy();
  });

  it("only applies to type 'transferencia'", () => {
    const txs = [consumo({ counterparty: TITULAR })];
    const [result] = markInternalTransfers(txs, { titular: TITULAR });

    expect(result.is_internal).toBeFalsy();
  });

  // El titular en blanco no es un imposible: `strategy_config` puede tener la
  // clave escrita con espacios, y `onboard/status.ts` la lee como "sin
  // configurar" con este mismo `trim()`. Sin el guard, `normalizeName("  ")`
  // colapsa a "" y marcaria como interna cualquier contraparte en blanco.
  it.each([null, "", "   "])("does not mark anything when the titular is unset (%j)", (titular) => {
    const txs = [transferencia({ counterparty: TITULAR }), transferencia({ counterparty: "   " })];

    expect(() => markInternalTransfers(txs, { titular })).not.toThrow();
    expect(markInternalTransfers(txs, { titular }).every((tx) => !tx.is_internal)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rule 4: sueldo vs recibido pass through unchanged (spec 5.3.4 / AC4)
// ---------------------------------------------------------------------------

describe("reconcile (full pipeline)", () => {
  it("leaves sueldo and recibido classifications untouched", () => {
    const sueldo = consumo({
      type: "sueldo",
      direction: "in",
      counterparty: "Acme Corp S.A.",
      gmail_msg_id: "msg-sueldo",
    });
    const recibido = consumo({
      type: "recibido",
      direction: "in",
      counterparty: "Juan Perez",
      gmail_msg_id: "msg-recibido",
    });

    const result = reconcile([sueldo, recibido], [], { titular: TITULAR });

    const outSueldo = result.transactions.find((tx) => tx.gmail_msg_id === "msg-sueldo");
    const outRecibido = result.transactions.find((tx) => tx.gmail_msg_id === "msg-recibido");
    expect(outSueldo?.type).toBe("sueldo");
    expect(outRecibido?.type).toBe("recibido");
  });

  it("runs reversal, dedup, and internal-transfer marking together", () => {
    const reversedConsumo = consumo();
    const appOrder = retiro({ gmail_msg_id: "msg-retiro-orden", raw_subject: "Retiro de Efectivo sin Tarjeta (orden)" });
    const cajero = retiro({ gmail_msg_id: "msg-retiro-cajero" });
    const internalTransfer = transferencia({ counterparty: TITULAR });

    const result = reconcile([reversedConsumo, appOrder, cajero, internalTransfer], [reverso()], {
      titular: TITULAR,
    });

    const kept = result.transactions.map((tx) => tx.gmail_msg_id);
    expect(kept).toContain("msg-consumo-1");
    expect(kept).toContain("msg-retiro-cajero");
    expect(kept).not.toContain("msg-retiro-orden");
    expect(result.retirosRemoved).toHaveLength(1);

    const outConsumo = result.transactions.find((tx) => tx.gmail_msg_id === "msg-consumo-1");
    expect(outConsumo?.is_reversed).toBe(true);

    const outTransfer = result.transactions.find((tx) => tx.gmail_msg_id === "msg-transfer-1");
    expect(outTransfer?.is_internal).toBe(true);
  });
});
