/**
 * The deterministic cross-validation layer (AC2 / spec §6.1 "regla de
 * oro"): re-derives a number from Claude's `amount_text_raw` using the
 * SAME strict regex F1-03's parser (`server/src/parser/produbanco.ts`) uses
 * to read amounts from raw text, and compares it against the amount F1-03
 * already derived independently from the email. If they agree, the
 * candidate is trustworthy; if they disagree (or either side has no
 * amount), the caller must flag `needs_review` and exclude it from totals.
 * Claude's own numeric interpretation is never used as the source of truth.
 */

// Mirrors parser/produbanco.ts's USD_AMOUNT_RE / DOLLAR_AMOUNT_RE: exactly
// two decimal digits, trailing word boundary, so "9.421" or "9.4" never
// match and get silently mis-parsed.
const USD_AMOUNT_RE = /USD\s*([0-9]+\.[0-9]{2})\b/;
const DOLLAR_AMOUNT_RE = /\$\s*([0-9]+\.[0-9]{2})\b/;

/** Derives a number from an amount substring using the same strict
 * anchoring the deterministic parser applies to raw email text. Returns
 * `null` for anything that doesn't match — never guessed. */
export function deriveAmountFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(USD_AMOUNT_RE) ?? text.match(DOLLAR_AMOUNT_RE);
  return match ? Number(match[1]) : null;
}

/** Cents-safe equality, matching rules/reconcile.ts's `amountsEqual` so
 * float drift (0.1 + 0.2 style) never causes a false mismatch. */
function amountsEqual(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

export interface AmountValidationResult {
  /** true only when both sides parsed to the same amount (cents-safe). */
  ok: boolean;
  /** The amount derived from `claudeAmountText`, or null if unparseable. */
  derived: number | null;
}

/**
 * Re-validates Claude's `amount_text_raw` against the deterministic
 * parser's own amount (AC2). `parserAmount === null` (F1-03 already
 * couldn't find an amount) or an unparseable/absent `claudeAmountText` both
 * count as "cannot confirm" -> not ok.
 */
export function validateAmount(
  parserAmount: number | null,
  claudeAmountText: string | null | undefined
): AmountValidationResult {
  const derived = deriveAmountFromText(claudeAmountText);
  if (parserAmount === null || derived === null) {
    return { ok: false, derived };
  }
  return { ok: amountsEqual(parserAmount, derived), derived };
}
