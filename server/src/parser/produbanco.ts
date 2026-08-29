/**
 * Parser de las notificaciones de Produbanco.
 *
 * Está escrito contra el formato REAL de los correos, medido sobre una bandeja
 * de verdad y documentado en docs/formato-correos-produbanco.md. Cada rama de
 * `classify` corresponde a una sección de ese documento; si algo acá no cierra,
 * el documento es la fuente de verdad y este archivo el que está mal.
 *
 * La mecánica de leer campos (normalizar el marcado, anclar a la etiqueta,
 * cortar antes de la siguiente) NO vive acá: está en `parser/field-extract.ts`
 * y la comparten todos los bancos. Lo específico de Produbanco es qué etiquetas
 * usa, cuáles pueden seguir a cuál, y qué significa cada una — eso es lo que
 * declara este archivo.
 *
 * Dos cosas que el formato impone y que no son obvias leyendo sólo el código:
 *
 * - **El mismo label significa cosas distintas según el sentido del
 *   movimiento.** `Cuenta Destino` es la cuenta del usuario en una
 *   transferencia recibida y la del beneficiario en una enviada, así que sólo
 *   la primera va en `account`.
 * - **A veces el dato existe únicamente en la prosa.** La tarjeta de un consumo
 *   con crédito, la contraparte de una transferencia recibida y todo lo de la
 *   transferencia internacional no aparecen en ningún campo etiquetado.
 */

import {
  extractAccountHolder,
  extractField,
  extractLabeledAmount,
  MASKED_ACCOUNT_RE,
  maskedAccount,
  normalizeBody,
  type LabeledAmount,
} from "./field-extract.js";
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
  if (format === "usd" || format === "either") match = text.match(USD_AMOUNT_RE);
  if (!match && (format === "dollar" || format === "either")) match = text.match(DOLLAR_AMOUNT_RE);
  return match ? Number(match[1]) : null;
}

/**
 * Los correos que traen el monto DOS veces (en el asunto y en un campo del
 * cuerpo) se leen de las dos fuentes y se comparan. Las dos lecturas son
 * deterministas: que no coincidan no significa "elegí una", significa que una
 * de las dos se leyó mal y ninguna es de fiar, así que la fila sale sin monto y
 * marcada — que es lo que la deja fuera de todos los totales.
 *
 * Cuando el correo trae el monto en un solo lugar, la otra lectura es null y no
 * hay nada que comparar.
 */
interface AmountReading {
  amount: number | null;
  /** El motivo de revisión que corresponde, o `null` si no hay nada que marcar
   * (el monto se leyó y las dos fuentes coinciden). */
  reason: string | null;
}

function crossCheckAmount(fromSubject: number | null, fromBody: LabeledAmount): AmountReading {
  // El cuerpo se contradice a sí mismo: la etiqueta aparece dos veces con
  // montos distintos. No se compara con el asunto — no hay con qué comparar.
  if (fromBody.ambiguous) return { amount: null, reason: "ambiguous_labeled_amount" };

  if (fromSubject !== null && fromBody.amount !== null && !sameAmount(fromSubject, fromBody.amount)) {
    return { amount: null, reason: "subject_body_amount_mismatch" };
  }

  return { amount: fromSubject ?? fromBody.amount, reason: null };
}

/** En centavos: los dos vienen de una regex de dos decimales, pero compararlos
 * como float haría que 0.1 + 0.2 decidiera si una fila se marca. */
function sameAmount(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

// Labels que el banco puede escribir en la MISMA línea a continuación de otro
// campo. El envuelto del mailer normalmente deja un `<br>` entre campos (y ahí
// corta el `\n`), pero los cuerpos reconstruidos desde un respaldo llegan en
// una sola línea, y ahí el único límite es el label siguiente.
const AFTER_CONTACTO = ["Banco Destino", "Cuenta Destino", "Cuenta", "Monto", "Descripción", "Canal", "Referencia"];
const AFTER_CUENTA = [
  "Cajero",
  "Fecha y Hora",
  "Fecha",
  "Hora",
  "Descripción",
  "Referencia",
  "Monto",
  "Valor",
  "Establecimiento",
];
const AFTER_ESTABLECIMIENTO = ["Cuenta Débito", "Cuenta", "Fecha y Hora", "Fecha", "Referencia", "Valor", "Monto"];

const DEBIT_ACCOUNT_LABEL = "Cuenta Débito";

/**
 * El titular tal como lo escribe el encabezado ("Estimado/a\n<NOMBRE>"), que
 * es la fuente más completa que existe: el nombre que acompaña a la cuenta en
 * `Cuenta Débito` suele venir recortado a un solo nombre de pila, y en varios
 * tipos de correo ese campo directamente no está.
 *
 * Se exige que el nombre esté en su propia línea y que no contenga `:` para no
 * confundirlo con el primer campo del cuerpo cuando el saludo no trae nombre.
 */
const HEADER_HOLDER_RE = /Estimado\/a[:\s]*\n[^\S\n]*([^\n:]{2,60})\n/;

function accountHolder(body: string): string | null {
  const fromHeader = cleanFieldValue(body.match(HEADER_HOLDER_RE)?.[1]);
  return fromHeader ?? extractAccountHolder(body, DEBIT_ACCOUNT_LABEL, AFTER_CUENTA);
}

/** El primer grupo de una regex de prosa, ya limpio. Las contrapartes y las
 * cuentas que sólo viven en una frase salen todas por acá. */
function fromProse(body: string, re: RegExp): string | null {
  return cleanFieldValue(body.match(re)?.[1]);
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

/** Arma el par (monto, motivo de revisión) de un correo que trae el monto por
 * duplicado, para no repetir el mismo `reviewReason` en cada rama. */
function reviewed(reading: AmountReading, reasonWhenMissing: string) {
  return { amount: reading.amount, reviewReason: reading.reason ?? reasonWhenMissing };
}

// ---------------------------------------------------------------------------
// Prosa: los datos que no viven en ningún campo etiquetado (doc secciones 4.2,
// 4.4, 4.7, 4.8)
// ---------------------------------------------------------------------------

/** "...con tu Tarjeta de Crédito Visa Produbanco XXX4321 ." — el consumo con
 * crédito no trae campo `Cuenta`: la tarjeta está sólo acá. */
const CREDIT_CARD_RE = new RegExp(`tarjeta de cr[eé]dito[^.\\n]*?(${MASKED_ACCOUNT_RE.source})`, "i");

/** "Te confirmamos que <NOMBRE> ha realizado una transferencia" — no existe
 * ningún campo `De:` ni `Remitente:` en estos correos. */
const REMITENTE_RE = /te confirmamos que\s+(.+?)\s+ha realizado una transferencia/i;

/** "...en tu cuenta XXXXXX54321 de la transferencia..." (internacional). */
const CUENTA_ACREDITADA_RE = new RegExp(`en tu cuenta\\s+(${MASKED_ACCOUNT_RE.source})`, "i");

/** "...debitado de la cuenta ANA XXXXXX54321." (compra de minutos). El punto
 * final va pegado a la cuenta, por eso el corte es en `.` y no en `\s`. */
const CUENTA_DEBITADA_RE = new RegExp(`de la cuenta\\s+[^.\\n]*?(${MASKED_ACCOUNT_RE.source})`, "i");

/** "por un valor de USD 12.34" — minutos Claro. */
const VALOR_PROSA_RE = /por un valor de\s+USD\s*([0-9]+\.[0-9]{2})\b/i;

/** "por el valor de USD 1234.56." — transferencia internacional. */
const VALOR_INTERNACIONAL_RE = /por el valor de\s+USD\s*([0-9]+\.[0-9]{2})\b/i;

/**
 * La empresa de una transferencia internacional, anclada al ÚLTIMO "de" antes
 * de "por el valor": la frase real ("...de la transferencia Internacional
 * Recibida de EMPRESA S.A. por el valor...") trae un "de" anterior que una
 * captura perezosa ingenua se llevaría por delante.
 */
const EMPRESA_INTERNACIONAL_RE = /\bde\s+((?:(?!\bde\s).)+?)\s+por el valor/i;

/** El nombre del servicio va pegado al `Transacción:` ("Pago de Servicio
 * Combos Ejemplo") y se repite en `Descripción:`. No hay campo "Empresa". */
const SERVICIO_RE = /Pago de Servicio\s+(.+?)(?=\n|$)/i;

function amountFromProse(body: string, re: RegExp): number | null {
  const match = body.match(re);
  return match ? Number(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Classification (spec 5.1 catalog + 5.2 ignore list)
// ---------------------------------------------------------------------------

function classify(email: InboundEmail): ParseResult {
  const subject = normalize(email.subject);
  const rawSubject = email.subject;
  // Una sola normalización para todo el correo: de acá en adelante ninguna
  // rama —ni las que leen campos ni las que leen prosa— tiene que acordarse de
  // si el cuerpo venía en HTML o en texto plano.
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
      counterparty: extractField(body, "Establecimiento", AFTER_ESTABLECIMIENTO),
      account: maskedAccount(extractField(body, DEBIT_ACCOUNT_LABEL, AFTER_CUENTA)),
      raw_subject: rawSubject,
      forceReview: true,
      reviewReason: `foreign_currency_${foreign[2]}`,
    });
  }

  // 4.1: el monto viene en el asunto Y en `Valor:`; la cuenta en `Cuenta
  // Débito`, con el titular delante.
  if (subject.includes("consumo tarjeta de debito por usd")) {
    const reading = crossCheckAmount(extractAmount(rawSubject, "usd"), extractLabeledAmount(body, "Valor"));
    return transaction({
      type: "debito",
      direction: "out",
      counterparty: extractField(body, "Establecimiento", AFTER_ESTABLECIMIENTO),
      account: maskedAccount(extractField(body, DEBIT_ACCOUNT_LABEL, AFTER_CUENTA)),
      raw_subject: rawSubject,
      ...reviewed(reading, "amount_not_found_in_subject"),
    });
  }

  // 4.2: igual que el débito, salvo que no hay ningún campo `Cuenta` — la
  // tarjeta sale de la prosa.
  if (subject.includes("consumo tarjeta de credito por usd")) {
    const reading = crossCheckAmount(extractAmount(rawSubject, "usd"), extractLabeledAmount(body, "Valor"));
    return transaction({
      type: "credito",
      direction: "out",
      counterparty: extractField(body, "Establecimiento", AFTER_ESTABLECIMIENTO),
      account: fromProse(body, CREDIT_CARD_RE),
      raw_subject: rawSubject,
      ...reviewed(reading, "amount_not_found_in_subject"),
    });
  }

  // 4.3: `Cuenta Destino` acá es la cuenta del BENEFICIARIO. El correo no dice
  // de qué cuenta salió la plata, así que `account` queda null: guardar la del
  // beneficiario sería poner un dato correcto en el campo equivocado.
  if (subject.includes("transferencia enviada por")) {
    const reading = crossCheckAmount(extractAmount(rawSubject, "dollar"), extractLabeledAmount(body, "Monto"));
    return transaction({
      type: "transferencia",
      direction: "out",
      counterparty:
        extractField(body, "Contacto", AFTER_CONTACTO) ?? extractField(body, "Beneficiario", AFTER_CONTACTO),
      account: null,
      raw_subject: rawSubject,
      ...reviewed(reading, "amount_not_found_in_subject"),
    });
  }

  // 4.5: el monto va con USD (no con $) y `Cuenta Débito` trae sólo la cuenta.
  if (subject.includes("pago de servicio por usd")) {
    const reading = crossCheckAmount(extractAmount(rawSubject, "usd"), extractLabeledAmount(body, "Monto"));
    return transaction({
      type: "servicio",
      direction: "out",
      counterparty: fromProse(body, SERVICIO_RE) ?? extractField(body, "Descripción", AFTER_CUENTA),
      account: maskedAccount(extractField(body, DEBIT_ACCOUNT_LABEL, AFTER_CUENTA)),
      raw_subject: rawSubject,
      ...reviewed(reading, "amount_not_found_in_subject"),
    });
  }

  // 4.6: el asunto no trae monto; `Cuenta débito` va en minúscula y la sigue
  // el campo `Cajero`.
  if (subject.includes("retiro sin tarjeta de debito") && subject.includes("cajero automatico")) {
    const monto = extractLabeledAmount(body, "Monto");
    return transaction({
      type: "retiro",
      direction: "out",
      amount: monto.amount,
      account: maskedAccount(extractField(body, DEBIT_ACCOUNT_LABEL, AFTER_CUENTA)),
      raw_subject: rawSubject,
      reviewReason: monto.ambiguous ? "ambiguous_labeled_amount" : "amount_not_found_in_body",
    });
  }

  // 4.8: sin bloque `Detalle`; monto y cuenta salen los dos de la prosa.
  if (subject.includes("compra minutos claro")) {
    return transaction({
      type: "recarga",
      direction: "out",
      amount: amountFromProse(body, VALOR_PROSA_RE),
      counterparty: "Claro",
      account: fromProse(body, CUENTA_DEBITADA_RE),
      raw_subject: rawSubject,
      reviewReason: "amount_not_found_in_body",
    });
  }

  // 4.7: tampoco hay `Detalle` — cuenta, empresa y monto están en una sola frase.
  if (subject.includes("transferencia internacional recibida")) {
    return transaction({
      type: "sueldo",
      direction: "in",
      amount: amountFromProse(body, VALOR_INTERNACIONAL_RE),
      counterparty: fromProse(body, EMPRESA_INTERNACIONAL_RE),
      account: fromProse(body, CUENTA_ACREDITADA_RE),
      raw_subject: rawSubject,
      reviewReason: "amount_not_found_in_body",
    });
  }

  // 4.4: el asunto NO trae monto (sale de `Monto:`), no existe campo
  // `De:`/`Remitente:` (la contraparte está en la prosa), y `Cuenta Destino`
  // acá SÍ es la cuenta del usuario: el dinero entra ahí.
  //
  // El cross-check con el asunto se hace igual: los correos reales no traen el
  // monto ahí, pero si alguno lo trajera serían dos afirmaciones independientes
  // del mismo número y el desacuerdo tiene que marcar, no elegir.
  if (subject.includes("transferencia recibida desde produbanco")) {
    const reading = crossCheckAmount(extractAmount(rawSubject, "either"), extractLabeledAmount(body, "Monto"));
    return transaction({
      type: "recibido",
      direction: "in",
      counterparty: fromProse(body, REMITENTE_RE),
      account: maskedAccount(extractField(body, "Cuenta Destino", AFTER_CUENTA)),
      raw_subject: rawSubject,
      ...reviewed(reading, "amount_not_found_in_body"),
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
  /** El nombre del titular se completa aquí y no en cada rama de `classify`:
   * sale del encabezado, que es igual en todos los tipos de correo. */
  parse(email) {
    const result = classify(email);
    if (result.kind !== "transaction" || result.account_holder) return result;
    return { ...result, account_holder: accountHolder(normalizeBody(email.body)) };
  },
};
