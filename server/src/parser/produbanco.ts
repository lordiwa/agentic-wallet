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
/** La plantilla vieja de transferencia (doc 4.15/4.16) usa `Beneficiario` donde
 * la nueva usa `Contacto`, y agrega `Enviada por` / `Banco Origen`. */
const AFTER_BENEFICIARIO = [
  "Banco Beneficiario",
  "Cuenta Beneficiario",
  "Banco Origen",
  "Beneficiario",
  "Monto",
  "Descripción",
  "Canal",
  "Referencia",
];
/** `Transacción:` es un campo más en los correos que no traen bloque `Detalle`
 * (la cobranza automática lleva ahí el nombre de la empresa). */
const AFTER_TRANSACCION = ["Canal", "Monto", "Fecha y Hora", "Fecha", "Detalle"];

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
  /** El tipo de correo es un movimiento entre cuentas propias — ver
   * `ParsedTransaction.is_internal`. */
  isInternal?: boolean;
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
    ...(params.isInternal === true ? { is_internal: true } : {}),
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

/**
 * "...debitado de su cuenta AHO XXXXXX54321." — la cuenta de la que sale la
 * plata en los correos que no traen bloque `Detalle` (recarga, notificación de
 * pago de servicio, pago de tarjeta). El punto final va pegado a la cuenta, por
 * eso el corte es en `.` y no en `\s`.
 *
 * Las tres preposiciones son obligatorias, no defensivas: el cuerpo real de la
 * recarga dice **"de su cuenta"** y el del pago de tarjeta **"de la cuenta"**.
 * Con el ancla fija en `de la cuenta` la recarga perdía la cuenta entera —
 * `account = null` en el 100 % de las recargas de la bandeja real.
 */
const CUENTA_DEBITADA_RE = new RegExp(`de (?:la|su|tu) cuenta\\s+[^.\\n]*?(${MASKED_ACCOUNT_RE.source})`, "i");

/** "por un valor de USD 12.34" — recargas y notificación de pago de servicio. */
const VALOR_PROSA_RE = /por un valor de\s+USD\s*([0-9]+\.[0-9]{2})\b/i;

/** "por el monto de USD 123.45" — pago de tarjeta de crédito. Es la tercera
 * forma que usa Produbanco para decir lo mismo; cada una vive donde su correo
 * la usa en vez de fundirse en una alternancia que matchearía cualquier cosa. */
const MONTO_PROSA_RE = /por el monto de\s+USD\s*([0-9]+\.[0-9]{2})\b/i;

/** "Registramos el pago de la tarjeta VISA EJEMPLO XXXXXXXXXXXX4321 por el
 * monto de..." — la tarjeta pagada es la contraparte del pago, y sólo está acá. */
const TARJETA_PAGADA_RE = /pago de la tarjeta\s+(.+?)\s+por el monto de/i;

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

/** La empresa de una cobranza automática va pegada al `Transacción:`, con el
 * prefijo "DEBITO" delante ("DEBITO EMPRESA EJEMPLO S.A"). */
const COBRANZA_PREFIJO_RE = /^DEBITO\s+/i;

/**
 * La operadora de una recarga sale del ASUNTO (`COMPRA MINUTOS CLARO`,
 * `COMPRA RECARGA MOVISTAR`) porque el cuerpo la escribe distinto en cada
 * variante ("compra de minutos Claro" / "una recarga Movistar"). Se lee del
 * asunto normalizado, así que llega en minúsculas y hay que capitalizarla.
 */
const RECARGA_SUBJECT_RE = /^compra (?:minutos|recarga)\s+(.+?)\s*$/;

function amountFromProse(body: string, re: RegExp): number | null {
  const match = body.match(re);
  return match ? Number(match[1]) : null;
}

/** "movistar" -> "Movistar". Sólo para la operadora de recarga, que viene del
 * asunto en mayúsculas y pasa por `normalize`. */
function capitalize(text: string): string {
  return text.replace(/\S+/g, (word) => word[0].toUpperCase() + word.slice(1));
}

/** La empresa que cobró, del `Transacción: DEBITO <EMPRESA>` de una cobranza
 * automática. Se le quita el prefijo `DEBITO`: es el verbo del banco, no parte
 * del nombre, y dejarlo rompería el matching por substring de las reglas de
 * categoría que escribe el usuario. */
function cobranzaEmpresa(body: string): string | null {
  const transaccion = extractField(body, "Transacción", AFTER_TRANSACCION);
  return transaccion === null ? null : cleanFieldValue(transaccion.replace(COBRANZA_PREFIJO_RE, ""));
}

// ---------------------------------------------------------------------------
// 5.2: los correos que NO son movimientos de plata
// ---------------------------------------------------------------------------

/**
 * Asuntos verificados en la bandeja real que **no mueven plata**, con el motivo
 * con el que se descartan. Es una lista explícita y no el caso por defecto a
 * propósito: `unrecognized_subject` significa "no sé qué es esto" y hay que
 * mirarlo; estas entradas significan "sé qué es y no va al ledger".
 *
 * Dos de ellas son trampas activas, no ruido:
 *
 * - **`retiro de efectivo sin tarjeta`** es la EMISIÓN DEL CÓDIGO, no el
 *   retiro. El retiro llega después en su propio correo (doc 4.6) y llega
 *   siempre: en la bandeja real los dos aparecen apareados con ~1 h de
 *   diferencia. Catalogar éste contaría cada retiro dos veces.
 * - **`consumo no procesado`** es un consumo RECHAZADO por fondos
 *   insuficientes, y su cuerpo trae un `$12.34` bien formado. Un catálogo laxo
 *   inventaría un gasto que nunca ocurrió.
 *
 * El orden importa: `reverso pago tarjeta de credito` tiene que resolverse acá
 * antes de que la rama de catálogo vea el `pago tarjeta de credito` que
 * contiene.
 */
const NON_MOVEMENT_SUBJECTS: ReadonlyArray<readonly [fragment: string, reason: string]> = [
  ["retiro de efectivo sin tarjeta", "retiro_code_issued"],
  ["consumo no procesado", "consumo_no_procesado"],
  ["estado de cuenta tarjeta de credito", "statement_attachment_only"],
  // El pago de tarjeta se registra como movimiento interno (excluido de todos
  // los totales), así que su reverso tampoco cambia ningún número: guardarlo
  // sólo agregaría una fila que no neteaba nada.
  ["reverso pago tarjeta de credito", "credit_card_payment_reversal_internal"],
  ["ingreso exitoso", "login_notification"],
  ["ingreso fallido", "login_notification"],
  ["ingreso incorrecto de clave", "login_notification"],
  ["clave temporal", "security_notice"],
  ["cambio de clave", "security_notice"],
  ["clave incorrecta", "security_notice"],
  ["error en ingreso de cvv", "security_notice"],
  ["bloqueo", "security_notice"],
  ["desbloqueo", "security_notice"],
  ["cancelacion de tu tarjeta", "security_notice"],
  ["entrega tarjeta", "security_notice"],
  ["no aceptada", "security_notice"],
  ["confirmacion transacciones tarjeta", "security_notice"],
  ["notificacion modificacion de contacto", "contact_modified"],
  ["consulta y registro de servicios", "bank_service_notice"],
  ["valora tu opinion", "customer_support"],
  ["reclamo", "customer_support"],
  ["respuesta id", "customer_support"],
];

/** El motivo de descarte de `subject` (ya normalizado), o `null` si no está en
 * la lista — en cuyo caso le toca a las ramas de catálogo. */
function ignoreReason(subject: string): string | null {
  return NON_MOVEMENT_SUBJECTS.find(([fragment]) => subject.includes(fragment))?.[1] ?? null;
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
  // El aporte y el retiro del FlexiAhorro son las dos mitades del mismo
  // movimiento interno: plata que va y vuelve entre dos cuentas del usuario.
  // Se descartan igual y por la misma razón.
  if (subject.includes("retiro de tu flexiahorro") || subject.includes("aportaste a tu flexiahorro")) {
    return { kind: "ignored", reason: "flexiahorro_internal_transfer" };
  }
  if (subject.includes("estado de cuenta produbanco")) {
    return { kind: "statement", raw_subject: rawSubject };
  }

  const noEsMovimiento = ignoreReason(subject);
  if (noEsMovimiento !== null) {
    return { kind: "ignored", reason: noEsMovimiento };
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

  // 4.6 y 4.12: dos asuntos ("Retiro sin tarjeta de débito ... en cajero
  // automático" y "Retiro de Efectivo Produbanco en Cajero Automático") con el
  // MISMO bloque `Detalle`. El asunto no trae monto; `Cuenta débito` va en
  // minúscula y la sigue el campo `Cajero`.
  //
  // La condición pide "cajero automatico" y no sólo "retiro": es lo que
  // distingue el retiro EJECUTADO del correo que sólo emite el código
  // (descartado arriba como `retiro_code_issued`).
  if (subject.includes("retiro") && subject.includes("cajero automatico")) {
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

  // 4.8 y 4.10: sin bloque `Detalle`; monto y cuenta salen los dos de la prosa,
  // y la operadora del asunto (`COMPRA MINUTOS CLARO`, `COMPRA RECARGA
  // MOVISTAR`), que es donde se escribe igual en las dos variantes.
  const recarga = subject.match(RECARGA_SUBJECT_RE);
  if (recarga) {
    return transaction({
      type: "recarga",
      direction: "out",
      amount: amountFromProse(body, VALOR_PROSA_RE),
      counterparty: capitalize(recarga[1]),
      account: fromProse(body, CUENTA_DEBITADA_RE),
      raw_subject: rawSubject,
      reviewReason: "amount_not_found_in_body",
    });
  }

  // 4.11: sin `Detalle`, sin ningún campo de cuenta —el correo no dice de dónde
  // salió la plata, así que `account` queda null— y con el `Monto:` SIN token
  // de moneda, que es lo que exige el `bareAllowed` de la capa compartida.
  if (subject.includes("cobranza con debito automatico")) {
    const monto = extractLabeledAmount(body, "Monto", { bareAllowed: true });
    return transaction({
      type: "servicio",
      direction: "out",
      amount: monto.amount,
      counterparty: cobranzaEmpresa(body),
      account: null,
      raw_subject: rawSubject,
      reviewReason: monto.ambiguous ? "ambiguous_labeled_amount" : "amount_not_found_in_body",
    });
  }

  // 4.13: el pago de la propia tarjeta de crédito. Todo está en una frase.
  //
  // Va marcado `is_internal`: la plata sale de una cuenta propia para bajar una
  // deuda propia. El gasto ya se contó cuando se usó la tarjeta (las filas
  // `credito`), así que sumarlo otra vez acá contaría el mismo consumo dos
  // veces. `markInternalTransfers` no puede deducirlo —compara la contraparte
  // contra el titular, y acá la contraparte es la tarjeta—, por eso lo afirma
  // el parser.
  if (subject.includes("pago tarjeta de credito")) {
    return transaction({
      type: "transferencia",
      direction: "out",
      amount: amountFromProse(body, MONTO_PROSA_RE),
      counterparty: fromProse(body, TARJETA_PAGADA_RE),
      account: fromProse(body, CUENTA_DEBITADA_RE),
      isInternal: true,
      raw_subject: rawSubject,
      reviewReason: "amount_not_found_in_body",
    });
  }

  // 4.14: otro pago de servicio, con otra plantilla. Verificado que NO es un
  // duplicado del 4.5: en la bandeja real los dos llegan el mismo minuto por
  // dos servicios distintos pagados en la misma sesión.
  if (subject.includes("notificacion pago de servicio")) {
    return transaction({
      type: "servicio",
      direction: "out",
      amount: amountFromProse(body, VALOR_PROSA_RE),
      counterparty: fromProse(body, SERVICIO_RE),
      account: fromProse(body, CUENTA_DEBITADA_RE),
      raw_subject: rawSubject,
      reviewReason: "amount_not_found_in_body",
    });
  }

  // 4.15: la plantilla vieja de la transferencia enviada (`Beneficiario` en vez
  // de `Contacto`). `Cuenta Beneficiario` es del OTRO, así que `account` va
  // null — el mismo criterio que 4.3, por la misma razón.
  if (subject.includes("transferencia acreditada")) {
    const reading = crossCheckAmount(extractAmount(rawSubject, "dollar"), extractLabeledAmount(body, "Monto"));
    return transaction({
      type: "transferencia",
      direction: "out",
      counterparty: extractField(body, "Beneficiario", AFTER_BENEFICIARIO),
      account: null,
      raw_subject: rawSubject,
      ...reviewed(reading, "amount_not_found_in_body"),
    });
  }

  // 4.16: la plantilla vieja de la transferencia recibida. A diferencia de 4.4,
  // acá el remitente SÍ tiene campo propio (`Enviada por`), y la cuenta
  // acreditada —la del usuario— es `Cuenta Beneficiario`.
  if (subject.includes("transferencia recibida en produbanco")) {
    const reading = crossCheckAmount(extractAmount(rawSubject, "either"), extractLabeledAmount(body, "Monto"));
    return transaction({
      type: "recibido",
      direction: "in",
      counterparty: extractField(body, "Enviada por", AFTER_BENEFICIARIO),
      account: maskedAccount(extractField(body, "Cuenta Beneficiario", AFTER_BENEFICIARIO)),
      raw_subject: rawSubject,
      ...reviewed(reading, "amount_not_found_in_body"),
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
