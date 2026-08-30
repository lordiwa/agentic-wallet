/**
 * Reparación del doble-encode UTF-8 → latin-1 en el cuerpo de un correo.
 *
 * ## El bug
 *
 * Verificado sobre la bandeja real: el correo de `COMPRA MINUTOS CLARO` llega
 * declarando `Content-Type: text/html; charset=us-ascii` y con bytes que **no**
 * son ASCII: donde el texto dice "información", los bytes son `C3 83 C2 B3` en
 * vez de `C3 B3`. Es decir, el mailer tomó los bytes UTF-8 de la "ó", los leyó
 * como si fueran latin-1 (`Ã³`) y volvió a codificar ESO en UTF-8. El daño ya
 * viene hecho desde el emisor: decodificar como UTF-8 —que es lo correcto—
 * produce `informaciÃ³n`.
 *
 * No es cosmético. Ese texto llega a `counterparty`, y las reglas de categoría
 * que el usuario configura en el onboarding comparan por substring: un comercio
 * con tilde guardado mojibakeado no matchea nunca la regla que el usuario
 * escribió bien.
 *
 * ## Por qué acá y no en el parser
 *
 * Es un problema de **decodificación del mensaje**, no de la gramática de los
 * campos: el parser de cualquier otro banco heredaría exactamente el mismo
 * daño. Vive en la capa de lectura (`decodePartData` del cliente de Gmail) para
 * que ningún parser tenga que saber que existe.
 *
 * ## Por qué no se repara siempre
 *
 * Revertir el doble-encode es re-codificar el texto a latin-1 y volver a
 * decodificarlo como UTF-8. Eso sólo es correcto si el texto ENTERO está
 * dañado: en un cuerpo mezclado, una "ó" sana produciría el byte `F3` suelto,
 * que no es UTF-8 válido, y el resultado traería `U+FFFD` — se perdería el
 * carácter sano para arreglar el roto. Por eso hay tres guardas, y si
 * cualquiera falla se devuelve el texto tal cual llegó: **nunca se degrada un
 * cuerpo para intentar mejorarlo.**
 */

/**
 * windows-1252 para los bytes `80..9F`, indexado desde `0x80`; `null` en los
 * cinco huecos que esa tabla deja sin asignar.
 *
 * Hace falta porque esos bytes **no existen en latin-1**, así que el mailer que
 * produjo el doble-encode los interpretó con windows-1252 (la única de las dos
 * tablas donde tienen glifo). Revertirlo exige deshacer primero esa
 * sustitución: la `Ñ` (UTF-8 `C3 91`) llega como `Ã` + `U+2018`, no como `Ã` +
 * `U+0091`.
 *
 * Sin este paso el daño se repara en las vocales acentuadas —que caen en
 * `A0..BF`, donde windows-1252 y latin-1 coinciden— y **no** en la eñe, que es
 * justo la letra que más aparece en los nombres del ledger.
 */
const CP1252_HIGH: ReadonlyArray<number | null> = [
  0x20ac, null, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, null, 0x017d, null,
  null, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, null, 0x017e, 0x0178,
];

const BYTE_BY_CP1252_CHAR = new Map<string, string>(
  CP1252_HIGH.flatMap((codePoint, index) =>
    codePoint === null ? [] : [[String.fromCodePoint(codePoint), String.fromCharCode(0x80 + index)] as const]
  )
);

const CP1252_CHARS_RE = new RegExp(`[${[...BYTE_BY_CP1252_CHAR.keys()].join("")}]`, "g");

/** Deshace la tabla windows-1252 para que cada carácter vuelva a ser el byte
 * que representaba. Su resultado sólo se usa si las guardas de abajo pasan. */
function foldCp1252(text: string): string {
  return text.replace(CP1252_CHARS_RE, (char) => BYTE_BY_CP1252_CHAR.get(char) ?? char);
}

/**
 * La firma del doble-encode: `Ã` o `Â` (los dos caracteres que produce leer un
 * byte líder UTF-8 como latin-1) seguidos de otro carácter del bloque alto.
 * Pedir el PAR y no sólo la `Ã` es lo que lo distingue de una `Ã` legítima —
 * existe en portugués y en varios apellidos.
 */
const MOJIBAKE_RE = /[\u00c3\u00c2][\u0080-\u00bf]/;

/** Cualquier código > U+00FF no sobrevive un round-trip por latin-1. */
const OUTSIDE_LATIN1_RE = /[^\u0000-\u00ff]/;

const REPLACEMENT_CHAR = "\ufffd";

/**
 * Devuelve `text` con el doble-encode revertido, o `text` intacto si no hay
 * evidencia clara de que esté dañado. Idempotente.
 */
export function repairMojibake(text: string): string {
  const folded = foldCp1252(text);
  if (!MOJIBAKE_RE.test(folded)) return text;
  if (OUTSIDE_LATIN1_RE.test(folded)) return text;

  const repaired = Buffer.from(folded, "latin1").toString("utf-8");
  return repaired.includes(REPLACEMENT_CHAR) ? text : repaired;
}
