import { cleanFieldValue } from "./html-text.js";
import type { BankEmailParser, Direction, InboundEmail, ParseResult, TransactionType } from "./types.js";

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Strips accents and lowercases, so subject matching is tolerant of
 * "débito"/"debito", "crédito"/"credito", "automático"/"automatico", etc. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Strict amount regexes: exactly two decimal digits, with a trailing word
// boundary so "9.421" or "9.4" never match. Per AC6 an amount that doesn't
// match one of these is never guessed — the transaction is flagged instead.
const USD_AMOUNT_RE = /USD\s*([0-9]+\.[0-9]{2})\b/;
const DOLLAR_AMOUNT_RE = /\$\s*([0-9]+\.[0-9]{2})\b/;

/**
 * Consumo en moneda extranjera, p.ej. "Consumo tarjeta de débito por ARS
 * 16000.00". Antes estos correos no matcheaban ninguna rama del catálogo
 * (todas exigían "por usd") y caían al fondo como transacción sin monto, así
 * que el consumo se perdía. Ahora se reconocen, se les extrae el monto y la
 * moneda REAL, y salen siempre con needs_review=1: el resto del sistema es
 * USD-only (strategy_config.moneda) y no hay tipo de cambio en el correo, así
 * que convertir el monto sería inventar un número. Marcarlo lo mantiene fuera
 * de todos los agregados (EXCLUDE_FROM_TOTALS_SQL filtra needs_review) sin
 * perder el registro de que la transacción existió.
 */
const FOREIGN_CONSUMO_RE = /consumo tarjeta de (debito|credito) por ([a-z]{3})/;
const FOREIGN_AMOUNT_RE = /[A-Z]{3}\s*([0-9]+(?:\.[0-9]{2})?)/;

type AmountFormat = "usd" | "dollar" | "either";

function extractAmount(text: string, format: AmountFormat): number | null {
  let match: RegExpMatchArray | null = null;
  if (format === "usd" || format === "either") {
    match = text.match(USD_AMOUNT_RE);
  }
  if (!match && (format === "dollar" || format === "either")) {
    match = text.match(DOLLAR_AMOUNT_RE);
  }
  return match ? Number(match[1]) : null;
}

/**
 * Extracts an amount anchored to a specific "Label: USD X.XX" / "Label: $X.XX"
 * field, rather than scanning the whole text for the first amount-shaped
 * substring. Bodies routinely contain other dollar figures (saldo, comisión,
 * etc.) before the field that actually matters — matching unanchored risks
 * silently returning the wrong number instead of the intended one.
 */
function extractLabeledAmount(text: string, label: string): number | null {
  const re = new RegExp(`${label}\\s*:\\s*(?:USD\\s*|\\$\\s*)([0-9]+\\.[0-9]{2})\\b`, "i");
  const match = text.match(re);
  return match ? Number(match[1]) : null;
}

// Labels that can immediately follow a counterparty field in Produbanco
// bodies; extraction stops at the first one so trailing fields never leak
// into the captured name (e.g. "Contacto: X Banco Destino: Y" -> "X").
const FIELD_STOP_WORDS =
  "(?:Banco Destino|Cuenta Destino|Cuenta\\s*d[eé]bito|Fecha|Hora|Referencia|Establecimiento|Contacto|Beneficiario|Monto|Cuenta)\\s*:";

/** Extracts the value of a "Label: value" field from a body, stopping before
 * the next known field label, a newline, or the end of the string.
 *
 * El valor pasa por `cleanFieldValue` porque no todo cuerpo llega ya en texto
 * plano: los que se reconstruyen desde un respaldo, o los que el cliente de
 * Gmail no pudo desarmar, traen HTML y el marcado terminaba guardado dentro de
 * `counterparty` (ver `html-text.ts`). */
function extractField(body: string, label: string): string | null {
  const re = new RegExp(`${label}\\s*:\\s*(.+?)(?=\\s+${FIELD_STOP_WORDS}|\\n|$)`, "i");
  const match = body.match(re);
  return match ? cleanFieldValue(match[1]) : null;
}

/** Extracts the trailing masked-account token from a "Cuenta débito: NAME XXXXXX1234" field. */
function extractDebitAccount(body: string): string | null {
  const field = extractField(body, "Cuenta\\s*d[eé]bito");
  if (!field) return null;
  const tokens = field.split(/\s+/);
  return tokens.length > 0 ? tokens[tokens.length - 1] : null;
}

/**
 * El NOMBRE del titular que precede a la cuenta enmascarada en el mismo campo
 * ("Cuenta débito: PEREZ GOMEZ ANA MARIA XXXXXX20924" -> "PEREZ GOMEZ ANA
 * MARIA"). Se guarda porque es la unica pista del titular que dejan los
 * correos, y el onboarding la necesita para proponerlo en vez de proponer el
 * numero de cuenta. Devuelve null cuando el campo solo trae la cuenta.
 */
function extractDebitAccountHolder(body: string): string | null {
  const field = extractField(body, "Cuenta\\s*d[eé]bito");
  if (!field) return null;
  const name = field.split(/\s+/).slice(0, -1).join(" ").trim();
  return name === "" ? null : name;
}

function transaction(params: {
  type: TransactionType;
  direction: Direction;
  amount: number | null;
  counterparty?: string | null;
  account?: string | null;
  account_holder?: string | null;
  raw_subject: string;
  reviewReason?: string;
  /** ISO-4217 del consumo. Por defecto USD — el único caso que lo pasa
   * explícito es el consumo en moneda extranjera. */
  currency?: string;
  /** Fuerza needs_review aunque el monto sí se haya podido leer. */
  forceReview?: boolean;
}): ParseResult {
  const needsReview = params.amount === null || params.forceReview === true;
  return {
    kind: "transaction",
    type: params.type,
    direction: params.direction,
    amount: params.amount,
    currency: params.currency ?? "USD",
    counterparty: params.counterparty ?? null,
    account: params.account ?? null,
    account_holder: params.account_holder ?? null,
    raw_subject: params.raw_subject,
    needs_review: needsReview,
    ...(needsReview ? { review_reason: params.reviewReason ?? "amount_not_found" } : {}),
  };
}

// ---------------------------------------------------------------------------
// Classification (spec 5.1 catalog + 5.2 ignore list)
// ---------------------------------------------------------------------------

function classify(email: InboundEmail): ParseResult {
  const subject = normalize(email.subject);
  const rawSubject = email.subject;
  const body = email.body;

  // --- 5.2 ignore / non-transaction markers (checked first: some of these
  // share words with catalog subjects, e.g. "retiro", "recibida") ---

  if (subject.includes("notificacion ingreso app movil produbanco")) {
    return { kind: "ignored", reason: "login_notification" };
  }
  if (subject.includes("reverso consumo tarjeta")) {
    return { kind: "reverso", raw_subject: rawSubject };
  }
  if (subject.includes("notificacion creacion de contacto produbanco")) {
    return { kind: "ignored", reason: "contact_created" };
  }
  if (subject.includes("manten tu flexiahorro en marcha")) {
    return { kind: "ignored", reason: "flexiahorro_reminder" };
  }
  if (subject.includes("retiro de tu flexiahorro")) {
    return { kind: "ignored", reason: "flexiahorro_internal_transfer" };
  }
  if (subject.includes("estado de cuenta produbanco")) {
    return { kind: "statement", raw_subject: rawSubject };
  }

  // --- 5.1 catalog ---

  const foreign = subject.match(FOREIGN_CONSUMO_RE);
  if (foreign && foreign[2] !== "usd") {
    return transaction({
      type: foreign[1] === "credito" ? "credito" : "debito",
      direction: "out",
      amount: rawSubject.match(FOREIGN_AMOUNT_RE) ? Number(rawSubject.match(FOREIGN_AMOUNT_RE)![1]) : null,
      currency: foreign[2].toUpperCase(),
      counterparty: extractField(body, "Establecimiento"),
      raw_subject: rawSubject,
      forceReview: true,
      reviewReason: `foreign_currency_${foreign[2]}`,
    });
  }

  if (subject.includes("consumo tarjeta de debito por usd")) {
    return transaction({
      type: "debito",
      direction: "out",
      amount: extractAmount(rawSubject, "usd"),
      counterparty: extractField(body, "Establecimiento"),
      raw_subject: rawSubject,
      reviewReason: "amount_not_found_in_subject",
    });
  }

  if (subject.includes("consumo tarjeta de credito por usd")) {
    return transaction({
      type: "credito",
      direction: "out",
      amount: extractAmount(rawSubject, "usd"),
      counterparty: extractField(body, "Establecimiento"),
      raw_subject: rawSubject,
      reviewReason: "amount_not_found_in_subject",
    });
  }

  if (subject.includes("transferencia enviada por")) {
    return transaction({
      type: "transferencia",
      direction: "out",
      amount: extractAmount(rawSubject, "dollar"),
      counterparty: extractField(body, "Contacto") ?? extractField(body, "Beneficiario"),
      raw_subject: rawSubject,
      reviewReason: "amount_not_found_in_subject",
    });
  }

  if (subject.includes("pago de servicio por usd")) {
    const serviceMatch = body.match(/Pago de Servicio Combos\s+(\S+)/i);
    return transaction({
      type: "servicio",
      direction: "out",
      amount: extractAmount(rawSubject, "usd"),
      counterparty: serviceMatch ? serviceMatch[1] : null,
      raw_subject: rawSubject,
      reviewReason: "amount_not_found_in_subject",
    });
  }

  if (subject.includes("retiro sin tarjeta de debito") && subject.includes("cajero automatico")) {
    return transaction({
      type: "retiro",
      direction: "out",
      // Anchored to the "Monto:" field, not the first "$X.XX" in the body —
      // bodies can list other figures (saldo disponible, etc.) first.
      amount: extractLabeledAmount(body, "Monto"),
      account: extractDebitAccount(body),
      account_holder: extractDebitAccountHolder(body),
      raw_subject: rawSubject,
      reviewReason: "amount_not_found_in_body",
    });
  }

  if (subject.includes("compra minutos claro")) {
    const bodyMatch = body.match(/por un valor de\s+USD\s*([0-9]+\.[0-9]{2})\b/i);
    return transaction({
      type: "recarga",
      direction: "out",
      amount: bodyMatch ? Number(bodyMatch[1]) : null,
      counterparty: "Claro",
      raw_subject: rawSubject,
      reviewReason: "amount_not_found_in_body",
    });
  }

  if (subject.includes("transferencia internacional recibida")) {
    // Anchored to the LAST "de" before "por el valor": bodies like "...
    // transferencia de parte de Acme Corp S.A. por el valor..." have an
    // earlier, irrelevant "de" that a naive lazy match would capture into.
    const empresaMatch = body.match(/\bde\s+((?:(?!\bde\s).)+?)\s+por el valor/i);
    const amountMatch = body.match(/por el valor de\s+USD\s*([0-9]+\.[0-9]{2})\b/i);
    return transaction({
      type: "sueldo",
      direction: "in",
      amount: amountMatch ? Number(amountMatch[1]) : null,
      counterparty: empresaMatch ? empresaMatch[1].trim() : null,
      raw_subject: rawSubject,
      reviewReason: "amount_not_found_in_body",
    });
  }

  if (subject.includes("transferencia recibida desde produbanco")) {
    // The subject's own amount (when present) is a single, unambiguous
    // value. Otherwise fall back to the body's anchored "Monto:" field —
    // never an unanchored scan, which could pick up an unrelated figure
    // (saldo, comisión, etc.) that happens to appear earlier in the body.
    const amount = extractAmount(rawSubject, "either") ?? extractLabeledAmount(body, "Monto");
    return transaction({
      type: "recibido",
      direction: "in",
      amount,
      counterparty: extractField(body, "De") ?? extractField(body, "Remitente"),
      raw_subject: rawSubject,
      reviewReason: "amount_not_found",
    });
  }

  return { kind: "ignored", reason: "unrecognized_subject" };
}

export const produbancoParser: BankEmailParser = {
  bankId: "produbanco",
  gmailSenders: ["produbanco"],
  canParse(email) {
    return /produbanco/i.test(email.subject) || /produbanco/i.test(email.body);
  },
  /** El nombre del titular se completa aqui y no en cada rama de `classify`:
   * el campo "Cuenta débito" aparece en cuerpos de varios tipos (consumo,
   * retiro, ...) y siempre significa lo mismo. */
  parse(email) {
    const result = classify(email);
    if (result.kind !== "transaction" || result.account_holder) return result;
    return { ...result, account_holder: extractDebitAccountHolder(email.body) };
  },
};
