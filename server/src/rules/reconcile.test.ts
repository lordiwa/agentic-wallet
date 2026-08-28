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
