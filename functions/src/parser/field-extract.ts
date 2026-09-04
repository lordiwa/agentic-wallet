/**
 * Lectura de campos "Etiqueta: valor" y de cuentas enmascaradas en el cuerpo de
 * un correo bancario. **Capa compartida: no sabe de ningún banco en particular.**
 *
 * ## Por qué existe
 *
 * El mismo cuerpo lo leen dos lugares (los parsers de banco y
 * `ingest/reverso-extract.ts`), y la forma de estos campos no es una
 * peculiaridad de Produbanco sino de cómo todo mailer bancario arma sus
 * notificaciones. Lo específico de un banco —qué etiquetas usa, cuáles pueden
 * seguir a cuál— lo declara quien llama; acá sólo está la mecánica.
 *
 * Un cuerpo bancario tampoco llega siempre en texto plano: Produbanco alterna
 * entre un `multipart/alternative` plano y uno anidado, y hay correos que sólo
 * traen `text/html`. El mismo correo llega entonces como
 *
 * ```
 * Monto:\n$45.00                          (texto plano)
 * <STRONG>Monto:</STRONG> \r\n  $45.00<BR> (HTML)
 * ```
 *
 * Un ancla sobre el cuerpo crudo matchea la primera y **no** la segunda: el
 * `</STRONG>` se interpone entre la etiqueta y su valor. El resultado no es un
 * error visible — es `amount: null`, que el pipeline persiste como placeholder
 * y deja fuera de todos los totales. En el ledger real eso se comió el 100 % de
 * las transferencias recibidas y de los retiros. Por eso todo lo de acá
 * normaliza el cuerpo primero (`normalizeBody`), y no sólo el cliente de Gmail:
 * el parser también corre sobre cuerpos que no pasaron por ahí (fixtures,
 * reconstrucción desde respaldos, otro cliente de correo).
 *
 * ## Qué garantiza
 *
 * - **Nunca adivina.** El monto sale de la etiqueta pedida o no sale: sin match
 *   se devuelve `null`, jamás la primera cifra que haya en el cuerpo.
 * - **Dos decimales y un token de moneda** al principio del valor. Sin la
 *   moneda, un `Fecha: 01.07.2026` se leería como el monto 1.07; con una regex
 *   laxa, `$1,050.00` se leería como 50.00 — plausible y equivocado.
 * - **La ambigüedad se marca, no se resuelve.** Ver `extractLabeledAmount`.
 *
 * Ver docs/formato-correos-produbanco.md para el formato que motivó cada
 * decisión: la etiqueta con dos grafías (`Cuenta Débito` / `Cuenta débito`), el
 * relleno de espacios de `Establecimiento`, y las formas de la máscara.
 */

import { cleanFieldValue, htmlToText } from "./html-text.js";

/**
 * Cuenta o tarjeta enmascarada: una corrida de `X` (o de `*` / `•`, que usan
 * otros bancos) seguida de los últimos dígitos. El largo de la máscara **no**
 * se normaliza: `XXXXXX54321` y `XXX4321` pueden terminar en los mismos dígitos
 * y ser una cuenta y una tarjeta distintas, así que recortar mezclaría dos
 * identificadores. Se guarda el token tal cual llega.
 */
export const MASKED_ACCOUNT_RE = /(?<![0-9A-Za-z])(?:[Xx]{3,}|\*{3,}|•{3,})[0-9]{3,}(?![0-9])/;

/**
 * Cuerpo del correo como texto plano, venga como venga.
 *
 * Idempotente: un cuerpo que ya es texto plano vuelve igual, así que es seguro
 * llamarla sin saber si la entrada trae marcado (y llamarla dos veces).
 */
export function normalizeBody(body: string): string {
  return htmlToText(body);
}

/**
 * Pliega acentos y mayúsculas **conservando la longitud**, para poder matchear
 * la etiqueta sobre el texto plegado y recortar el valor del texto original
 * (así el valor conserva sus acentos: "App Móvil", no "App Movil").
 *
 * Un `normalize("NFD")` sobre todo el texto correría los índices —"é" pasa a
 * ocupar dos posiciones—, por eso se pliega carácter por carácter y se deja
 * intacto el que no pliegue a exactamente uno.
 */
function fold(text: string): string {
  let out = "";
  for (const char of text) {
    const folded = char
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
    out += folded.length === char.length ? folded : char.toLowerCase();
  }
  return out;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * "Cuenta Débito" -> `cuenta\s+debito`. Las etiquetas se pasan tal como las
 * escribe el banco, no como regex: acá se escapan y se plegan. Lo único que se
 * afloja es el espacio entre palabras, porque el mailer envuelve el marcado y
 * ese espacio puede ser uno o varios.
 */
function labelPattern(label: string): string {
  return fold(label).trim().split(/\s+/).map(escapeRegExp).join("\\s+");
}

/**
 * `Etiqueta:` + su valor, cortado antes de la etiqueta siguiente, del salto de
 * línea, o del fin del cuerpo.
 *
 * El salto de línea es donde empieza el campo siguiente (ver `html-text.ts`).
 * Los `stopLabels` son las etiquetas que el banco puede poner en la MISMA línea
 * a continuación de ésta — pasa en los cuerpos reconstruidos desde un respaldo,
 * que llegan sin los `<br>` originales. Esa lista la declara quien llama en vez
 * de ser global: una etiqueta que corta un campo puede ser parte legítima del
 * valor de otro.
 */
/**
 * El hueco entre una etiqueta y su valor: espacios, **a lo sumo un salto de
 * línea**, y espacios de nuevo.
 *
 * Hace falta cruzar el salto porque en los cuerpos de texto plano el banco
 * escribe `"Monto:\n$45.00"` — la etiqueta en una línea y su valor en la
 * siguiente. Pero cruzarlo siempre haría que un campo VACÍO se llevara el valor
 * del campo siguiente (`"Contacto:\nMonto: $1.00"` → contacto = "Monto: $1.00"),
 * así que sólo se cruza cuando lo que sigue no tiene forma de etiqueta. Ese
 * guarda no depende de `stopLabels`: un campo vacío no puede robarse al
 * siguiente ni cuando quien llama no declaró ninguna.
 */
const LABEL_VALUE_GAP = "[^\\S\\n]*(?:\\n(?![^\\S\\n]*[^\\n:]{1,30}:)[^\\S\\n]*)?";

function fieldRegExp(label: string, stopLabels: readonly string[], flags: string): RegExp {
  const stop = stopLabels.length > 0 ? `\\s+(?:${stopLabels.map(labelPattern).join("|")})\\s*:|` : "";
  // El lookbehind evita que "Cuenta" matchee dentro de otra palabra; el patrón
  // corre sobre el texto ya plegado, por eso la clase es sólo `[0-9a-z]`.
  return new RegExp(`(?<![0-9a-z])${labelPattern(label)}\\s*:${LABEL_VALUE_GAP}(.*?)(?=${stop}\\n|$)`, flags);
}

/**
 * TODAS las apariciones del campo, en orden. Existe en plural porque el guarda
 * de ambigüedad de `extractLabeledAmount` necesita ver si la etiqueta se repite;
 * quien sólo quiere el valor usa `extractField`.
 */
function extractFieldValues(body: string, label: string, stopLabels: readonly string[]): string[] {
  const text = normalizeBody(body);
  const values: string[] = [];
  // `d` para poder recortar el valor del texto SIN plegar (y conservar sus
  // acentos): `fold` preserva la longitud, así que los índices coinciden.
  for (const match of fold(text).matchAll(fieldRegExp(label, stopLabels, "dg"))) {
    const indices = match.indices?.[1];
    if (!indices) continue;
    const value = cleanFieldValue(text.slice(indices[0], indices[1]));
    if (value !== null) values.push(value);
  }
  return values;
}

/**
 * Valor de un campo `Etiqueta: valor`.
 *
 * Devuelve `null` cuando el campo no está o cuando llegó vacío: un `""` diría
 * "el banco mandó el campo vacío", que no es lo mismo que "no había campo".
 */
export function extractField(body: string, label: string, stopLabels: readonly string[] = []): string | null {
  return extractFieldValues(body, label, stopLabels)[0] ?? null;
}

/** `USD 45.00` o `$45.00` al principio del valor: es lo que separa un monto de
 * una fecha o de un número de referencia. Dos decimales exactos. */
const VALUE_AMOUNT_RE = /^(?:USD|\$)\s*([0-9]+\.[0-9]{2})(?![0-9])/i;

/**
 * El mismo monto pero SIN token de moneda (`Monto: 45.00`), para los correos
 * donde el banco no lo escribe — verificado en la cobranza con débito
 * automático de Produbanco.
 *
 * Es opt-in por campo y nunca el default: sin la moneda delante, lo único que
 * separa un monto de una fecha o de una referencia es la forma del número, y
 * quien llama tiene que afirmar que ESA etiqueta trae un monto. Los dos
 * decimales exactos y el corte al inicio del valor siguen siendo obligatorios,
 * y el lookahead descarta todo lo que CONTINÚE con forma de número compuesto:
 * `Referencia: 987654321` no matchea (no tiene dos decimales) y
 * `Fecha: 01.07.2026` tampoco, aunque su prefijo "01.07" sí tenga la forma de
 * un monto — lo que lo delata es el separador que viene después.
 */
const BARE_VALUE_AMOUNT_RE = /^([0-9]+\.[0-9]{2})(?![0-9.,:/-])/;

export interface LabeledAmount {
  /** El monto leído, o `null` si no se pudo leer con certeza. */
  amount: number | null;
  /**
   * `true` cuando la etiqueta aparece más de una vez en el cuerpo con lecturas
   * distintas. `amount` es `null` en ese caso: el correo afirma dos cosas y
   * elegir una sería inventar.
   */
  ambiguous: boolean;
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
 * Dos apariciones que rinden el MISMO monto no son ambiguas —no hay nada que
 * elegir— y una aparición sin cifra (la palabra en prosa) tampoco compite. Lo
 * que se marca es el desacuerdo real.
 */
export interface LabeledAmountOptions {
  /**
   * Acepta también el monto escrito sin token de moneda (`Monto: 45.00`). Por
   * defecto `false`: ver `BARE_VALUE_AMOUNT_RE` para por qué es opt-in.
   */
  bareAllowed?: boolean;
}

export function extractLabeledAmount(
  body: string,
  label: string,
  { bareAllowed = false }: LabeledAmountOptions = {}
): LabeledAmount {
  const readings = new Set<number>();
  for (const value of extractFieldValues(body, label, [])) {
    const match = value.match(VALUE_AMOUNT_RE) ?? (bareAllowed ? value.match(BARE_VALUE_AMOUNT_RE) : null);
    if (match) readings.add(Number(match[1]));
  }

  if (readings.size === 0) return { amount: null, ambiguous: false };
  if (readings.size > 1) return { amount: null, ambiguous: true };
  return { amount: [...readings][0], ambiguous: false };
}

/** El token enmascarado que trae un valor de campo ("ANA XXXXXX54321" -> "XXXXXX54321"). */
export function maskedAccount(value: string | null | undefined): string | null {
  return value?.match(MASKED_ACCOUNT_RE)?.[0] ?? null;
}

/**
 * Lo que acompaña al token enmascarado dentro del mismo campo
 * ("PEREZ GOMEZ ANA MARIA XXXXXX54321" -> el nombre). Es la única evidencia del
 * titular que dejan algunos correos; va aparte de la cuenta porque mezclarlos
 * rompería el apareo de reverso y consumo.
 */
export function maskedAccountHolder(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const match = value.match(MASKED_ACCOUNT_RE);
  return match?.index === undefined ? null : cleanFieldValue(value.slice(0, match.index));
}

/**
 * La ventana de texto que sigue a `label`, cortada en la etiqueta siguiente.
 *
 * A diferencia de `extractField`, **cruza saltos de línea**: existe para los
 * cuerpos de texto plano donde el banco corta las líneas a lo ancho y no por
 * campo, y el titular queda en una línea y su cuenta en la siguiente, dentro
 * del mismo campo. Lo que hay entre esta etiqueta y la próxima es, por
 * construcción, este campo y nada más — pero eso vale sólo si `stopLabels`
 * nombra a las que pueden seguir, así que quien llama las declara.
 */
function fieldWindow(body: string, label: string, stopLabels: readonly string[]): string | null {
  const text = normalizeBody(body);
  const folded = fold(text);
  const start = new RegExp(`(?<![0-9a-z])${labelPattern(label)}\\s*:`).exec(folded);
  if (!start) return null;
  const rest = text.slice(start.index + start[0].length);
  if (stopLabels.length === 0) return rest;
  const stop = new RegExp(`(?:${stopLabels.map(labelPattern).join("|")})\\s*:`).exec(fold(rest));
  return stop ? rest.slice(0, stop.index) : rest;
}

/**
 * Token de cuenta enmascarada de un campo tipo
 * `"Cuenta débito: PEREZ ANA XXXXXX1234"` → `"XXXXXX1234"`, tolerando que el
 * valor esté partido en dos líneas.
 *
 * Ese token es lo que aparea un reverso con su consumo (`rules/reconcile.ts`),
 * así que perderlo no es cosmético — colapsa el apareo a "mismo monto, mismo
 * día". Devuelve `null` si en el campo no hay nada con forma de cuenta
 * enmascarada: mejor sin cuenta que con el nombre del titular metido en el
 * campo con el que se aparea.
 */
export function extractMaskedAccount(body: string, label: string, stopLabels: readonly string[] = []): string | null {
  const window = fieldWindow(body, label, stopLabels);
  return window === null ? null : maskedAccount(window.replace(/\s+/g, " "));
}

/**
 * El NOMBRE que precede a la cuenta enmascarada en el mismo campo
 * (`"Cuenta débito: PEREZ ANA XXXXXX1234"` → `"PEREZ ANA"`), tolerando el corte
 * de línea igual que `extractMaskedAccount`.
 *
 * Es la única pista del titular que dejan varios correos, y el onboarding la
 * necesita para proponerlo en vez de proponer el número de cuenta. Devuelve
 * `null` cuando el campo sólo trae la cuenta.
 */
export function extractAccountHolder(body: string, label: string, stopLabels: readonly string[] = []): string | null {
  const window = fieldWindow(body, label, stopLabels);
  return window === null ? null : maskedAccountHolder(window.replace(/\s+/g, " "));
}
