/**
 * HTML -> texto plano para cuerpos de correo bancario.
 *
 * Existe por un fallo real observado en producción: las contrapartes de
 * transferencia quedaron guardadas en la base como
 * `"</STRONG><SPAN>&nbsp;</SPAN>NOMBRE<BR><STRONG>Banco"` en vez de `"NOMBRE"`.
 *
 * La causa no es el regex de `extractField`, sino que el cuerpo que le llega
 * ya venía en HTML: cuando el correo no trae una parte `text/plain` en el
 * primer nivel (Produbanco alterna entre `multipart/alternative` plano y uno
 * anidado), el cliente de Gmail caía al `payload.body.data` crudo. El regex
 * hace entonces exactamente lo que se le pidió — capturar hasta el siguiente
 * label — y se lleva el marcado por delante.
 *
 * Se arregla en dos lugares a propósito: el cliente de Gmail deja de producir
 * HTML (`decodeBody`), y la extracción de campos limpia lo que reciba. Lo
 * segundo no es redundante: el parser también corre sobre cuerpos que no
 * pasaron por ese cliente (fixtures, reconstrucción desde respaldos), y una
 * contraparte con marcado envenena el matching de establecimientos de
 * `category/categorize.ts`, que compara por substring.
 */

/**
 * Entidades HTML que aparecen de hecho en los correos de Produbanco. La lista
 * es corta a propósito: no es un decodificador de HTML de propósito general,
 * y una entidad desconocida es mejor dejarla visible que traducirla mal.
 */
const ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&nbsp;/gi, " "],
  [/&amp;/gi, "&"],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&quot;/gi, '"'],
  [/&#39;|&apos;/gi, "'"],
];

/** Etiquetas cuyo contenido no es texto visible: `<style>body{...}</style>`
 * aportaría CSS al cuerpo. Se eliminan con contenido y todo, antes de quitar
 * el resto de las etiquetas. */
const NON_TEXT_ELEMENTS = /<(script|style|head)\b[^>]*>[\s\S]*?<\/\1>/gi;

/** Etiquetas que separan líneas. Se traducen a `\n` (y no a espacio) porque
 * `extractField` corta el valor de un campo en el salto de línea: colapsarlas
 * a espacio uniría "Contacto: X" con el campo siguiente. */
const LINE_BREAK_ELEMENTS = /<\s*(?:br|\/p|\/div|\/tr|\/li|\/h[1-6])\b[^>]*>/gi;

const ANY_TAG = /<[^>]*>/g;

/** Marca temporal de un salto SEMÁNTICO (el que declaró el marcado) mientras se
 * colapsa el resto del espacio en blanco. Es U+0000: no aparece en un correo. */
const BLOCK_BREAK = "\u0000";

/** ¿La entrada trae marcado? Distingue las dos gramáticas de esta función: en
 * HTML el salto de línea es espacio en blanco cualquiera, en texto plano es un
 * separador de campos. Sin esta pregunta habría que elegir una y romper la
 * otra. */
const HAS_MARKUP = /<[a-z!/][^>]*>/i;

function decodeEntities(text: string): string {
  let out = text;
  for (const [pattern, replacement] of ENTITIES) out = out.replace(pattern, replacement);
  // Numéricas (`&#160;`, `&#xA0;`) al final: decodificar antes convertiría un
  // `&#38;` en `&` y una secuencia como `&#38;nbsp;` se volvería `&nbsp;`,
  // que la pasada de arriba ya no vería.
  return out
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

/**
 * Convierte un cuerpo HTML en texto plano conservando los saltos de línea que
 * separan campos. Un texto que ya es plano pasa prácticamente intacto (sólo se
 * normalizan entidades y espacios), así que es seguro llamarla sin saber si la
 * entrada trae marcado.
 *
 * En la rama HTML el `\n` del código fuente **no** es un separador: el mailer
 * envuelve el marcado a ~72 columnas y ese salto cae en cualquier parte —
 * dentro de un label, entre el label y su valor, en medio del valor. Es
 * espacio en blanco como cualquier otro, así que se colapsa; los únicos saltos
 * que sobreviven son los que declaró el marcado (`<br>`, `</p>`, ...), que se
 * marcan con `BLOCK_BREAK` antes de colapsar. Ver
 * docs/formato-correos-produbanco.md sección 2.
 */
export function htmlToText(html: string): string {
  if (!HAS_MARKUP.test(html)) return collapsePlainText(decodeEntities(html));

  const withBreaks = html.replace(NON_TEXT_ELEMENTS, " ").replace(LINE_BREAK_ELEMENTS, BLOCK_BREAK);
  const text = decodeEntities(withBreaks.replace(ANY_TAG, " "));
  return text
    .replace(/\s+/g, " ")
    .replace(new RegExp(` ?${BLOCK_BREAK}[${BLOCK_BREAK} ]*`, "g"), "\n")
    .trim();
}

function collapsePlainText(text: string): string {
  return (
    text
      // El espacio duro de `&nbsp;` no lo toca `\s` en todos los motores; se
      // normaliza explícitamente para que el trim de `extractField` funcione.
      .replace(/\u00a0/g, " ")
      .replace(/[^\S\n]+/g, " ")
      .replace(/ *\n[ \n]*/g, "\n")
      .trim()
  );
}

/**
 * Limpia el valor de un campo ya extraído (una contraparte, un titular).
 *
 * A diferencia de `htmlToText`, aquí se corta en el primer salto de línea en
 * vez de conservarlo. El valor de un campo es un nombre, no un cuerpo, y el
 * salto es justamente donde empezaba el campo siguiente: en
 * `"</STRONG><SPAN>&nbsp;</SPAN>NOMBRE<BR><STRONG>Banco"` el `<BR>` separa la
 * contraparte del label "Banco Destino" que la seguía. Colapsarlo a espacio
 * dejaría `"NOMBRE Banco"`; cortarlo devuelve el nombre solo — el mismo
 * criterio que aplica `extractField` con su lookahead a `\n`.
 *
 * Devuelve `null` cuando no queda nada legible — un `""` en `counterparty`
 * significaría "el banco mandó la contraparte vacía", que no es lo mismo que
 * "no había contraparte".
 */
export function cleanFieldValue(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const cleaned = htmlToText(value).split("\n")[0].trim();
  return cleaned === "" ? null : cleaned;
}
