/**
 * Parses the body of a Produbanco "Estado de Cuenta" (statement) email into
 * the official card fields (spec 5.4). Pure: a string in, a plain object
 * out — no I/O, no persistence (that's `ingest-statement.ts`).
 *
 * Same philosophy as the F1-03 transaction parser: fields are extracted
 * with label-anchored regexes, never guessed. A field that doesn't match
 * its expected shape (missing, wrong decimal precision, incomplete date,
 * out-of-range/invalid calendar date) comes back `null` rather than a
 * best-effort value — the ingestion layer can flag `needs_review` on the
 * caller side.
 */

export interface ParsedStatement {
  card_mask: string | null;
  issue_date: string | null;
  min_payment: number | null;
  due_date: string | null;
  balance: number | null;
}

/**
 * Strips HTML tags to whitespace. Not an HTML parser — just enough to keep
 * label-anchored regexes tolerant of markup between a label and its value
 * (e.g. "<td>Label:</td><td>value</td>"), matching the plain-regex approach
 * already used by the F1-03 email parser.
 */
function stripTags(input: string): string {
  return input.replace(/<[^>]+>/g, " ");
}

/**
 * Strips combining diacritical marks after Unicode-decomposing the text
 * (NFD), so labels match regardless of whether the source body arrived
 * NFC-composed ("í" = U+00ED, one codepoint) or NFD-decomposed ("í" = "i" +
 * U+0301, two codepoints) — Gmail bodies aren't guaranteed to be one or the
 * other. Same technique as the F1-03 email parser's `normalize()`
 * (server/src/parser/produbanco.ts), minus the lowercasing: label matching
 * here already uses the `i` regex flag, and lowercasing the whole body
 * would corrupt captured values like the card mask ("XXXX" -> "xxxx").
 */
function stripDiacritics(input: string): string {
  return input.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * "YYYY / MM / DD" (whitespace around the slashes tolerated) -> ISO
 * "YYYY-MM-DD". Validates month (01-12), day (01-31), and real calendar
 * validity (e.g. rejects "2026-02-30" or "2026-04-31") via a round-trip
 * through `Date`. Any invalid or incomplete date returns null rather than
 * being persisted as garbage that could feed a payment strategy.
 */
function normalizeDate(year?: string, month?: string, day?: string): string | null {
  if (!year || !month || !day) return null;

  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;

  const roundTrip = new Date(Date.UTC(y, m - 1, d));
  const isRealCalendarDate =
    roundTrip.getUTCFullYear() === y && roundTrip.getUTCMonth() === m - 1 && roundTrip.getUTCDate() === d;
  if (!isRealCalendarDate) return null;

  return `${year}-${month}-${day}`;
}

function matchAmount(text: string, re: RegExp): number | null {
  const match = text.match(re);
  return match ? Number(match[1]) : null;
}

function matchDate(text: string, re: RegExp): string | null {
  const match = text.match(re);
  return match ? normalizeDate(match[1], match[2], match[3]) : null;
}

export function parseStatementBody(body: string): ParsedStatement {
  const text = stripDiacritics(stripTags(body));

  const cardMatch = text.match(/TARJETA\s*No\.?:\s*([0-9X]+)/i);

  return {
    card_mask: cardMatch ? cardMatch[1] : null,
    issue_date: matchDate(text, /Fecha de emisi[oó]n:\s*(\d{4})\s*\/\s*(\d{2})\s*\/\s*(\d{2})/i),
    min_payment: matchAmount(text, /Monto m[ií]nimo a pagar:\s*([0-9]+\.[0-9]{2})\b/i),
    due_date: matchDate(text, /Fecha m[aá]xima de pago:\s*(\d{4})\s*\/\s*(\d{2})\s*\/\s*(\d{2})/i),
    balance: matchAmount(text, /Valor total a pagar:\s*([0-9]+\.[0-9]{2})\b/i),
  };
}
