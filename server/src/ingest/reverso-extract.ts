/**
 * F1-03's `ReversoEmail` only carries `raw_subject` (see the CAVEAT in
 * server/src/rules/reconcile.ts's `ReversoCandidate` doc) — `produbanco.ts`
 * classifies the "Reverso Consumo Tarjeta" subject and stops there. F1-07
 * owns extracting amount/account from the same email body.
 *
 * La lectura de campos NO se implementa acá: se delega en
 * `parser/field-extract.ts`, la misma capa compartida que usan los parsers de
 * banco. Antes esto era "un lector chico y deliberadamente duplicado", y la
 * duplicación se cobró lo suyo: cuando un cuerpo llega con marcado, el
 * `</STRONG>` se mete entre la etiqueta y su valor y el ancla no matchea. En
 * el ledger real eso dejó `account` en NULL en los 136 reversos — y sin cuenta,
 * `rules/reconcile.ts` aparea sólo por monto y día.
 */

import {
  extractLabeledAmount,
  extractLabeledField,
  extractMaskedAccount,
  normalizeBody,
} from "../parser/field-extract.js";

// TASK-041: real "Reverso Consumo Tarjeta de Débito" emails carry the amount
// as a "Valor:" field in the Detalle block (not "Monto:"), and repeat it in
// prose ("...por un valor de USD X.XX en <establecimiento>."). Los dos
// primeros son campos etiquetados y los lee el helper compartido; el tercero
// es prosa y necesita su propia regex, con la misma disciplina de dos
// decimales + `\b` — nunca adivinado ni redondeado.
const AMOUNT_LABELS = ["Valor", "Monto"] as const;
const PROSE_AMOUNT_RE = /por un valor de\s+USD\s*([0-9]+\.[0-9]{2})\b/i;

const DEBIT_ACCOUNT_LABEL = "Cuenta\\s*d[eé]bito";
const ESTABLISHMENT_LABEL = "Establecimiento";

// Etiquetas que pueden seguir a un campo en un cuerpo de Produbanco; la
// lectura del campo corta en la primera para que no se le cuele el campo
// siguiente. La lista incluye la etiqueta que se está leyendo: el corte se
// busca DESPUÉS de ella, así que sólo frenaría en una segunda aparición.
const FIELD_STOP_LABELS = [
  "Fecha",
  "Hora",
  ESTABLISHMENT_LABEL,
  "Referencia",
  "Monto",
  "Valor",
  DEBIT_ACCOUNT_LABEL,
] as const;

export interface ExtractedReversoFields {
  amount: number | null;
  account: string | null;
  /** El comercio del consumo revertido. Es el segundo eje del apareo
   * (`rules/reconcile.ts`): cuando el correo de reverso no trae cuenta —el
   * cuerpo real de TASK-041 no la trae— es lo único que distingue dos
   * consumos del mismo monto el mismo día. */
  counterparty: string | null;
}

/** Extracts amount/account/counterparty from a "Reverso Consumo Tarjeta"
 * email body. `ts` and `gmail_msg_id` come from the enclosing `InboundEmail`
 * instead — the reverso notification's own arrival time/id, not anything in
 * the body. */
export function extractReversoFields(body: string): ExtractedReversoFields {
  return {
    amount: extractAmount(body),
    account: extractMaskedAccount(body, DEBIT_ACCOUNT_LABEL, FIELD_STOP_LABELS),
    counterparty: extractLabeledField(body, ESTABLISHMENT_LABEL, FIELD_STOP_LABELS),
  };
}

function extractAmount(body: string): number | null {
  for (const label of AMOUNT_LABELS) {
    const labeled = extractLabeledAmount(body, label);
    // Ambiguo (la etiqueta aparece con dos montos distintos) NO cae al
    // fallback siguiente: el correo se contradice a sí mismo y elegir otra
    // lectura sería tapar la contradicción. Sin monto → needs_review.
    if (labeled.ambiguous) return null;
    if (labeled.amount !== null) return labeled.amount;
  }
  // La prosa también se lee sobre el cuerpo normalizado: el marcado puede
  // partirla ("por un valor de <STRONG>USD 2.61</STRONG>").
  const prose = PROSE_AMOUNT_RE.exec(normalizeBody(body));
  return prose ? Number(prose[1]) : null;
}
