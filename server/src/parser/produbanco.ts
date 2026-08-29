import {
  extractAccountHolder,
  extractLabeledAmount,
  extractLabeledField,
  extractMaskedAccount,
  normalizeBody,
} from "./field-extract.js";
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
 * El vocabulario de etiquetas de Produbanco. Es lo ÚNICO específico del banco
 * en la lectura de campos: el cómo (normalizar el marcado, anclar a la
 * etiqueta, cortar antes de la siguiente) vive en `field-extract.ts` y lo
 * comparten todos los bancos. Un banco nuevo declara su propia lista.
 *
 * El orden importa: `Cuenta\s*débito` va antes que `Cuenta` para que la
 * alternación no corte a la mitad de la etiqueta más larga.
 */
const FIELD_STOP_LABELS = [
  "Banco Destino",
  "Cuenta Destino",
  "Cuenta\\s*d[eé]bito",
  "Fecha",
  "Hora",
  "Referencia",
  "Establecimiento",
  "Contacto",
  "Beneficiario",
  "Descripci[oó]n",
  "Cajero",
  "Monto",
  "Valor",
  "Cuenta",
] as const;

const DEBIT_ACCOUNT_LABEL = "Cuenta\\s*d[eé]bito";

function extractField(body: string, label: string): string | null {
  return extractLabeledField(body, label, FIELD_STOP_LABELS);
}

/** El token de cuenta enmascarada de "Cuenta débito: NOMBRE XXXXXX1234". */
function extractDebitAccount(body: string): string | null {
  return extractMaskedAccount(body, DEBIT_ACCOUNT_LABEL, FIELD_STOP_LABELS);
}

/**
 * El NOMBRE del titular que precede a la cuenta enmascarada en el mismo campo
 * ("Cuenta débito: PEREZ GOMEZ ANA MARIA XXXXXX20924" -> "PEREZ GOMEZ ANA
 * MARIA"). Se guarda porque es la unica pista del titular que dejan los
 * correos, y el onboarding la necesita para proponerlo en vez de proponer el
 * numero de cuenta. Devuelve null cuando el campo solo trae la cuenta.
 */
function extractDebitAccountHolder(body: string): string | null {
  return extractAccountHolder(body, DEBIT_ACCOUNT_LABEL, FIELD_STOP_LABELS);
}

/** El monto anclado al campo "Monto:" del cuerpo, con el guarda de ambigüedad. */
function extractBodyAmount(body: string): ReturnType<typeof extractLabeledAmount> {
  return extractLabeledAmount(body, "Monto");
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
  // Una sola normalización para todo el correo: de acá en adelante ninguna
  // rama tiene que acordarse de si el cuerpo venía en HTML o en texto plano.
  const body = normalizeBody(email.body);

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
    // Anchored to the "Monto:" field, not the first "$X.XX" in the body —
    // bodies can list other figures (saldo disponible, etc.) first.
    const monto = extractBodyAmount(body);
    return transaction({
      type: "retiro",
      direction: "out",
      amount: monto.amount,
      account: extractDebitAccount(body),
      account_holder: extractDebitAccountHolder(body),
      raw_subject: rawSubject,
      reviewReason: monto.ambiguous ? "ambiguous_labeled_amount" : "amount_not_found_in_body",
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
    // Asunto y cuerpo son DOS afirmaciones independientes del mismo monto
    // dentro del mismo correo. El `??` que había acá las trataba como
    // suplentes ("usá la que esté") y desperdiciaba la evidencia: si las dos
    // están y no coinciden, elegir una es adivinar. Es el mismo patrón que
    // usa `category/heal-counterparty.ts` — sólo se escribe si el correo,
    // releído hoy, rinde el MISMO monto.
    const fromSubject = extractAmount(rawSubject, "either");
    const fromBody = extractBodyAmount(body);
    const disagree = fromSubject !== null && fromBody.amount !== null && fromSubject !== fromBody.amount;
    return transaction({
      type: "recibido",
      direction: "in",
      amount: fromBody.ambiguous || disagree ? null : fromSubject ?? fromBody.amount,
      counterparty: extractField(body, "De") ?? extractField(body, "Remitente"),
      raw_subject: rawSubject,
      reviewReason: fromBody.ambiguous
        ? "ambiguous_labeled_amount"
        : disagree
          ? "subject_body_amount_mismatch"
          : "amount_not_found",
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
  /**
   * La cuenta y el titular se completan aqui y no en cada rama de `classify`:
   * el campo "Cuenta débito" aparece en cuerpos de varios tipos (consumo,
   * retiro, ...) y siempre significa lo mismo.
   *
   * `account` se poblaba SOLO en la rama de retiro, asi que los consumos
   * entraban sin cuenta — y `rules/reconcile.ts` considera iguales a dos
   * cuentas desconocidas, con lo que el apareo de un reverso degeneraba a
   * "mismo monto, mismo dia" y marcaba para siempre a los dos consumos que
   * coincidieran. Poblarla acá es lo que le devuelve al apareo su segundo eje.
   */
  parse(email) {
    const result = classify(email);
    if (result.kind !== "transaction") return result;
    const body = normalizeBody(email.body);
    return {
      ...result,
      account: result.account ?? extractDebitAccount(body),
      account_holder: result.account_holder ?? extractDebitAccountHolder(body),
    };
  },
};
