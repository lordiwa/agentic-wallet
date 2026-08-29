/**
 * F1-03's `ReversoEmail` only carries `raw_subject` (see the CAVEAT in
 * server/src/rules/reconcile.ts's `ReversoCandidate` doc) — `produbanco.ts`
 * classifies the "Reverso Consumo Tarjeta" subject and stops there. F1-07
 * owns extracting amount/account from the same email body, mirroring the
 * "Detalle Monto: $X.XX Cuenta débito: NAME XXXXXX1234" shape F1-03 already
 * reads for retiro emails (`extractLabeledAmount` / `extractDebitAccount`
 * in produbanco.ts — not exported, so this is a small, deliberately
 * duplicated reader rather than reaching into another ticket's file).
 */

import { cleanFieldValue } from "../parser/html-text.js";

const LABELED_AMOUNT_RE = /Monto\s*:\s*(?:USD\s*|\$\s*)([0-9]+\.[0-9]{2})\b/i;

// TASK-041: real "Reverso Consumo Tarjeta de Débito" emails carry the amount
// as a "Valor:" field in the Detalle block (not "Monto:"), and repeat it in
// prose ("...por un valor de USD X.XX en <establecimiento>."). Same strict
// two-decimal + \b discipline as LABELED_AMOUNT_RE — never guessed/coerced.
const VALOR_AMOUNT_RE = /Valor\s*:\s*(?:USD\s*|\$\s*)([0-9]+\.[0-9]{2})\b/i;
const PROSE_AMOUNT_RE = /por un valor de\s+USD\s*([0-9]+\.[0-9]{2})\b/i;

// Labels that can immediately follow "Cuenta débito" in a Produbanco body,
// mirroring produbanco.ts's FIELD_STOP_WORDS so a trailing field never
// leaks into the captured account token.
const FIELD_STOP_WORDS = "(?:Fecha|Hora|Referencia|Establecimiento|Monto)\\s*:";

function extractField(body: string, label: string): string | null {
  const re = new RegExp(`${label}\\s*:\\s*(.+?)(?=\\s+${FIELD_STOP_WORDS}|\\n|$)`, "i");
  const match = body.match(re);
  return match ? cleanFieldValue(match[1]) : null;
}

export interface ExtractedReversoFields {
  amount: number | null;
  account: string | null;
}

/** Extracts amount/account from a "Reverso Consumo Tarjeta" email body. `ts`
 * and `gmail_msg_id` come from the enclosing `InboundEmail` instead — the
 * reverso notification's own arrival time/id, not anything in the body. */
export function extractReversoFields(body: string): ExtractedReversoFields {
  // TASK-041: try "Valor:" first (what real reverso emails actually use),
  // then the legacy "Monto:" field, then the prose fallback. First match
  // wins; none matching leaves amount null (needs_review, never guessed).
  const amountMatch = body.match(VALOR_AMOUNT_RE) ?? body.match(LABELED_AMOUNT_RE) ?? body.match(PROSE_AMOUNT_RE);
  const amount = amountMatch ? Number(amountMatch[1]) : null;

  const accountField = extractField(body, "Cuenta\\s*d[eé]bito");
  const account = accountField ? accountField.split(/\s+/).pop() ?? null : null;

  return { amount, account };
}
