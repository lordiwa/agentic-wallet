import { describe, expect, it } from "vitest";
import { extractReversoFields } from "./reverso-extract.js";
import { reconcile, type ReconcilableTransaction, type ReversoCandidate } from "../rules/reconcile.js";

// A real-shaped "Reverso Consumo Tarjeta de Débito" body (TASK-041): no
// "Monto:" field at all — the amount lives in a "Valor:" field and in prose.
const REAL_REVERSO_BODY =
  "Transacción: Reverso Consumo Tarjeta de Débito Produbanco\n" +
  "Te informamos que se acaba de registrar el reverso de un consumo con la tarjeta VISA Produbanco XXXXXXXXXXXX1352 " +
  "por un valor de USD 2.61 en DLC* UBER RIDES SAN JOSE CR.\n" +
  "Detalle\n" +
  "Valor: USD 2.61\n" +
  "Establecimiento: DLC* UBER RIDES SAN JOSE CR";

describe("extractReversoFields", () => {
  it("extracts amount and account from a Monto:/Cuenta débito: body", () => {
    const result = extractReversoFields("Detalle Monto: $20.00 Cuenta débito: ANA XXXXXX20924");
    expect(result.amount).toBe(20.0);
    expect(result.account).toBe("XXXXXX20924");
  });

  it("extracts a USD-labeled amount too", () => {
    const result = extractReversoFields("Monto: USD 9.42 Fecha: 01/07/2026");
    expect(result.amount).toBe(9.42);
  });

  it("returns null amount when the body has no Monto: field", () => {
    const result = extractReversoFields("Un reverso sin el campo esperado.");
    expect(result.amount).toBeNull();
  });

  it("returns null account when the body has no Cuenta débito: field", () => {
    const result = extractReversoFields("Monto: $9.42 Fecha: 01/07/2026");
    expect(result.account).toBeNull();
  });

  it("stops the account field before a trailing label instead of swallowing it", () => {
    const result = extractReversoFields("Monto: $9.42 Cuenta débito: ANA XXXXXX20924 Fecha: 01/07/2026");
    expect(result.account).toBe("XXXXXX20924");
  });

  // TASK-041: real reverso emails carry the amount as "Valor:" (Detalle
  // block) and in prose, never as "Monto:" — extractReversoFields returned
  // amount=null for every real reverso before this fix.
  it("extracts the amount from a real-shaped body's 'Valor:' field (no Monto: present)", () => {
    const result = extractReversoFields(REAL_REVERSO_BODY);
    expect(result.amount).toBe(2.61);
  });

  it("falls back to the prose 'por un valor de USD X.XX' when there is no Valor:/Monto: field", () => {
    const result = extractReversoFields(
      "Te informamos que se acaba de registrar el reverso de un consumo por un valor de USD 5.00 en TIENDA X."
    );
    expect(result.amount).toBe(5.0);
  });

  it("still extracts a legacy 'Monto: $X.XX' body correctly (no regression)", () => {
    const result = extractReversoFields("Detalle Monto: $20.00 Cuenta débito: ANA XXXXXX20924");
    expect(result.amount).toBe(20.0);
  });

  it("returns null amount when neither Valor:, Monto:, nor the prose pattern is well-formed", () => {
    const result = extractReversoFields("Un reverso sin ningún campo de monto reconocible.");
    expect(result.amount).toBeNull();
  });

  it("leaves account null for a real reverso body with no 'Cuenta débito' field", () => {
    const result = extractReversoFields(REAL_REVERSO_BODY);
    expect(result.account).toBeNull();
  });
});

// TASK-041 end-to-end: a real-shaped reverso must actually reconcile against
// its matching debito consumo through the real reconcile.ts seam, not just
// through extractReversoFields in isolation.
describe("reconcile() with a real-shaped reverso body (TASK-041)", () => {
  it("marks the matching debito consumo is_reversed and applies one reversal", () => {
    const consumo: ReconcilableTransaction = {
      kind: "transaction",
      type: "debito",
      direction: "out",
      amount: 2.61,
      currency: "USD",
      account: null,
      raw_subject: "Notificación Consumo Tarjeta de Débito Produbanco",
      needs_review: false,
      gmail_msg_id: "consumo-1",
      ts: "2026-07-15T14:00:00.000Z",
    };

    const { amount, account } = extractReversoFields(REAL_REVERSO_BODY);
    expect(amount).not.toBeNull();

    const reverso: ReversoCandidate = {
      raw_subject: "Reverso Consumo Tarjeta de Débito Produbanco",
      amount: amount as number,
      account,
      ts: "2026-07-15T15:00:00.000Z",
      gmail_msg_id: "reverso-1",
    };

    const result = reconcile([consumo], [reverso], { titular: "Ana Perez" });

    expect(result.transactions[0].is_reversed).toBe(true);
    expect(result.reversalsApplied.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// El mismo agujero que perdía los montos del parser: cuerpos con marcado.
//
// Sobre el ledger real, `account` quedó en NULL en los 136 reversos — el
// `</STRONG>` se comía el valor del campo "Cuenta débito" entero. Los montos
// se salvaron de casualidad, por el fallback en prosa; los que no traían prosa
// quedaron sin monto. El arreglo es el mismo helper compartido que usa el
// parser (`parser/field-extract.ts`), no una copia más de la regex.
// ---------------------------------------------------------------------------

describe("extractReversoFields sobre cuerpos con marcado (HTML)", () => {
  const REVERSO_HTML =
    '<P><FONT face="Nunito Sans Normal">Detalle</FONT></P>\r\n' +
    "<P><STRONG>Valor:</STRONG> \r\n" +
    "            USD 2.61<BR><STRONG>Cuenta débito:</STRONG> \r\n" +
    "            PEREZ GOMEZ ANA XXXXXX4321<BR><STRONG>Establecimiento:</STRONG> \r\n" +
    "            TIENDA EJEMPLO</FONT></P>";

  it("lee el monto anclado a Valor: aunque el marcado se interponga", () => {
    expect(extractReversoFields(REVERSO_HTML).amount).toBe(2.61);
  });

  it("lee la cuenta enmascarada, que es con lo que se aparea el consumo", () => {
    expect(extractReversoFields(REVERSO_HTML).account).toBe("XXXXXX4321");
  });

  it("lee la cuenta aunque el valor del campo esté partido en dos líneas", () => {
    const cuerpo = "<STRONG>Cuenta débito:</STRONG> PEREZ GOMEZ ANA \r\nXXXXXX4321<BR><STRONG>Fecha:</STRONG> 01/07/2026";
    expect(extractReversoFields(cuerpo).account).toBe("XXXXXX4321");
  });

  it("marca el monto como no leído cuando la etiqueta trae dos valores distintos", () => {
    const cuerpo = "Valor: USD 2.61\nCorrección Valor: USD 9.99";
    expect(extractReversoFields(cuerpo).amount).toBeNull();
  });
});
