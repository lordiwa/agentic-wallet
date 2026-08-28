/**
 * Account masking (AC5: "cuentas enmascaradas antes de cualquier envio al
 * LLM"). Produbanco's own emails already mask account numbers
 * (e.g. "XXXXXX20924"), but this is defense in depth applied right before
 * anything is handed to the extractor — never rely solely on the sender.
 */

/** Masks any run of 6+ consecutive digits down to its last 4, e.g.
 * "0123456789" -> "XXXXXX6789". Already-masked tokens like "XXXXXX20924"
 * are untouched by the digit-run regex (the X's aren't digits), so this is
 * idempotent under reapplication. */
export function maskAccountNumbers(text: string): string {
  return text.replace(/\d{6,}/g, (digits) => "X".repeat(digits.length - 4) + digits.slice(-4));
}

/** Masks both `subject` and `body` of an email-shaped object, preserving
 * every other field untouched. */
export function maskEmailForExtractor<T extends { subject: string; body: string }>(email: T): T {
  return { ...email, subject: maskAccountNumbers(email.subject), body: maskAccountNumbers(email.body) };
}
