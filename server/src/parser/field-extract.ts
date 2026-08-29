/**
 * Lectura de campos "Etiqueta: valor" en el cuerpo de un correo bancario.
 * **Capa compartida: no sabe de ningún banco en particular.**
 *
 * ## Por qué existe
 *
 * Un cuerpo bancario no siempre llega en texto plano. Produbanco alterna
 * entre un `multipart/alternative` plano y uno anidado, y hay correos que
 * sólo traen `text/html`; el mismo correo llega entonces como
 *
 * ```
 * Monto:\n$45.00            (texto plano)
 * <STRONG>Monto:</STRONG> \r\n    $45.00<BR>   (HTML)
 * ```
 *
 * Un ancla `Monto\s*:\s*\$([0-9]+\.[0-9]{2})` matchea la primera y **no** la
 * segunda: el `</STRONG>` se interpone entre la etiqueta y su valor. El
 * resultado no es un error visible — es `amount: null`, que el pipeline
 * persiste como placeholder y deja fuera de todos los totales. En el ledger
 * real eso se comió el 100 % de las transferencias recibidas y de los retiros.
 *
 * El `googleapis-gmail-client` ya normaliza el HTML que él mismo baja, pero
 * esa es **una sola** puerta de entrada. El parser también corre sobre cuerpos
 * que no pasaron por ahí — fixtures, reconstrucción desde respaldos, otro
 * cliente de correo, el parser de otro banco — y ahí el bug vuelve idéntico.
 * Por eso la normalización vive acá, en la capa que todos los parsers usan, y
 * no en un banco.
 *
 * ## Qué garantiza
 *
 * - **Nunca adivina.** El monto sale de la etiqueta pedida o no sale: sin
 *   match se devuelve `null`, jamás la primera cifra que haya en el cuerpo.
 * - **Dos decimales obligatorios** (`[0-9]+\.[0-9]{2}` + `\b`) y un token de
 *   moneda (`USD` o `$`) pegado a la etiqueta. Sin la moneda, un
 *   `Fecha: 01.07.2026` se leería como el monto 1.07.
 * - **La ambigüedad se marca, no se resuelve.** Ver `extractLabeledAmount`.
 *
 * Si tu banco escribe la moneda con otro token, extendé `CURRENCY_PREFIX`
 * acá — no copies el regex a tu parser.
 */

import { cleanFieldValue, htmlToText } from "./html-text.js";

/** `USD 45.00` o `$45.00`. Obligatorio: es lo que separa un monto de una fecha. */
const CURRENCY_PREFIX = "(?:USD\\s*|\\$\\s*)";

/** Estrictamente dos decimales, con `\b` para que `9.421` no matchee como `9.42`. */
const STRICT_AMOUNT = "([0-9]+\\.[0-9]{2})\\b";

/**
 * El hueco entre una etiqueta y su valor: espacios, **a lo sumo un salto de
 * línea**, y espacios de nuevo.
 *
 * Un `\s*` a secas sería más simple y está mal. Al normalizar el HTML el valor
 * queda en la línea siguiente a su etiqueta (`"Monto:\n$45.00"`), así que hay
 * que poder cruzar el salto — pero cruzar CUALQUIER cantidad hace que un campo
 * vacío se lleve el valor del campo siguiente (`"Contacto:\nMonto: $1.00"` →
 * contacto = "Monto: $1.00"). Uno solo alcanza para el caso real y no inventa.
 */
const LABEL_VALUE_GAP = "[^\\S\\n]*\\n?[^\\S\\n]*";

/**
 * Cuerpo del correo como texto plano, venga como venga.
 *
 * Idempotente: un cuerpo que ya es texto plano vuelve igual, así que es seguro
 * llamarla sin saber si la entrada trae marcado (y llamarla dos veces).
 */
export function normalizeBody(body: string): string {
  return htmlToText(body);
}

export interface LabeledAmount {
  /** El monto leído, o `null` si no se pudo leer con certeza. */
  amount: number | null;
  /**
   * `true` cuando la etiqueta aparece más de una vez en el cuerpo con
   * lecturas distintas. `amount` es `null` en ese caso: el correo afirma dos
   * cosas y elegir una sería inventar.
   */
  ambiguous: boolean;
}

function labelPattern(label: string): string {
  return `${label}\\s*:`;
}

/**
 * Lee el monto anclado a `label` (`"Monto"`, `"Valor"`, …).
 *
 * Anclado y no "la primera cifra del cuerpo" a propósito: los cuerpos traen
 * saldo disponible y comisión antes del monto que importa, y un match suelto
 * devolvería el número equivocado en silencio.
 *
 * ### El guarda de ambigüedad
 *
 * Se dispara cuando **la etiqueta anclada aparece más de una vez con montos
 * distintos** — no cuando hay más de una cifra en el cuerpo. Esa segunda
 * formulación, que parece equivalente, marcaría el 100 % de los correos
 * (siempre hay un saldo antes), y una fila marcada no se desmarca nunca: sería
 * daño permanente.
 *
 * Dos apariciones que rinden el MISMO monto no son ambiguas — no hay nada que
 * elegir — y una aparición sin cifra (la palabra en prosa) tampoco compite. Lo
 * que se marca es el desacuerdo real.
 */
export function extractLabeledAmount(body: string, label: string): LabeledAmount {
  const text = normalizeBody(body);
  const anchored = new RegExp(`${labelPattern(label)}${LABEL_VALUE_GAP}${CURRENCY_PREFIX}${STRICT_AMOUNT}`, "gi");

  const readings = new Set<number>();
  for (const match of text.matchAll(anchored)) readings.add(Number(match[1]));

  if (readings.size === 0) return { amount: null, ambiguous: false };
  if (readings.size > 1) return { amount: null, ambiguous: true };
  return { amount: [...readings][0], ambiguous: false };
}

/**
 * Alternación regex de las etiquetas que terminan el valor de un campo.
 *
 * Cada banco tiene su vocabulario de etiquetas y lo pasa como lista; sin él,
 * un campo se lleva por delante el campo siguiente cuando los dos comparten
 * línea (`"Contacto: X Banco Destino: Y"` → `"X Banco Destino: Y"`).
 */
function stopLookahead(stopLabels: readonly string[]): string {
  if (stopLabels.length === 0) return "";
  return `\\s+(?:${stopLabels.join("|")})\\s*:|`;
}

/**
 * Valor de un campo `Etiqueta: valor`, cortado antes de la etiqueta siguiente,
 * del salto de línea, o del fin del cuerpo.
 *
 * Devuelve `null` cuando no queda nada legible: un `""` significaría "el banco
 * mandó el campo vacío", que no es lo mismo que "no había campo".
 */
export function extractLabeledField(body: string, label: string, stopLabels: readonly string[] = []): string | null {
  const text = normalizeBody(body);
  // El lookahead negativo es lo que hace que un campo vacío devuelva null en
  // vez de robarse el valor del campo siguiente.
  const notAnotherLabel = stopLabels.length === 0 ? "" : `(?!(?:${stopLabels.join("|")})\\s*:)`;
  const re = new RegExp(
    `${labelPattern(label)}${LABEL_VALUE_GAP}${notAnotherLabel}(.+?)(?=${stopLookahead(stopLabels)}\\n|$)`,
    "i"
  );
  const match = text.match(re);
  return match ? cleanFieldValue(match[1]) : null;
}

/**
 * Un número de cuenta o tarjeta enmascarado: los caracteres de máscara que usa
 * el banco (`XXXXXX20924`, `****1234`, `••••1234`) seguidos de los últimos
 * dígitos. Se busca POR SU FORMA y no "el último token del campo" porque el
 * HTML del banco corta las líneas a lo ancho, no por campo: el titular puede
 * quedar en una línea y la cuenta en la siguiente, dentro del mismo campo.
 */
const MASKED_ACCOUNT_TOKEN = /[Xx*•]{2,}[-\s]?[0-9]{2,}/;

/**
 * La ventana de texto que sigue a `label`, cortada en la etiqueta siguiente.
 *
 * Existe para que un lector tolere los saltos de línea DENTRO del valor de un
 * campo sin volverse un scan del cuerpo entero: lo que hay entre esta etiqueta
 * y la próxima es, por construcción, este campo y nada más.
 */
function fieldWindow(text: string, label: string, stopLabels: readonly string[]): string | null {
  const start = new RegExp(`${labelPattern(label)}`, "i").exec(text);
  if (!start) return null;
  const rest = text.slice(start.index + start[0].length);
  if (stopLabels.length === 0) return rest;
  const stop = new RegExp(`(?:${stopLabels.join("|")})\\s*:`, "i").exec(rest);
  return stop ? rest.slice(0, stop.index) : rest;
}

/**
 * Token de cuenta enmascarada de un campo tipo
 * `"Cuenta débito: PEREZ ANA XXXXXX1234"` → `"XXXXXX1234"`.
 *
 * Ese token es lo que aparea un reverso con su consumo
 * (`rules/reconcile.ts`), así que perderlo no es cosmético — colapsa el apareo
 * a "mismo monto, mismo día" y marca para siempre a los dos consumos que
 * coincidan. Devuelve `null` si en el campo no hay nada con forma de cuenta
 * enmascarada: mejor sin cuenta que con el nombre del titular metido en el
 * campo que se usa para aparear.
 */
export function extractMaskedAccount(body: string, label: string, stopLabels: readonly string[] = []): string | null {
  const window = fieldWindow(normalizeBody(body), label, stopLabels);
  if (window === null) return null;
  const match = window.match(MASKED_ACCOUNT_TOKEN);
  return match ? match[0].replace(/\s/g, "") : null;
}

/**
 * El NOMBRE que precede a la cuenta enmascarada en el mismo campo
 * (`"Cuenta débito: PEREZ ANA XXXXXX1234"` → `"PEREZ ANA"`).
 *
 * Es la única pista del titular que dejan los correos, y el onboarding la
 * necesita para proponerlo en vez de proponer el número de cuenta. Devuelve
 * `null` cuando el campo sólo trae la cuenta.
 */
export function extractAccountHolder(body: string, label: string, stopLabels: readonly string[] = []): string | null {
  const window = fieldWindow(normalizeBody(body), label, stopLabels);
  if (window === null) return null;
  const match = window.match(MASKED_ACCOUNT_TOKEN);
  if (!match) return null;
  const name = window.slice(0, match.index).replace(/\s+/g, " ").trim();
  return name === "" ? null : name;
}
