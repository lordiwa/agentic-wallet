/**
 * Cómo se escribe una cifra. **No cómo se calcula**: acá no se suma, no se
 * promedia y no se deriva nada — todo número que pasa por estas funciones ya
 * lo calculó el motor (regla 4 de §2.3 del plan).
 *
 * El idioma es `es` y nada más: es la lengua del panel entero. No se fija un
 * país, y por eso no se elige un símbolo de moneda ni se asume dónde va — la
 * moneda llega en los datos (`balance.currency`) y se dibuja al lado de la
 * cifra, como un rótulo. Poner "$" acá sería exactamente lo que CLAUDE.md
 * prohíbe: un valor plausible precargado que es de un país.
 */
const LOCALE = "es";

const PLATA = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const ENTERO = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 });

const DIA = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });

/**
 * Una cifra de plata, siempre con sus dos decimales. **`0` se escribe `0,00`**
 * y se dibuja con el peso de un número: cero es un monto válido, y lo
 * desconocido no llega hasta acá (lo dibuja quien sabe que falta, con su
 * rótulo — ver `ROTULO_SIN_LEER`).
 */
export function formatoPlata(valor: number): string {
  return PLATA.format(valor);
}

/** Un conteo: correos, movimientos, comercios. Sin decimales. */
export function formatoEntero(valor: number): string {
  return ENTERO.format(valor);
}

/**
 * La inversa de `formatoPlata`: lee la cifra que el usuario **escribió**.
 * Devuelve `null` cuando el texto no es una cifra, y esa es toda su gracia —
 * quien la llama tiene que decidir qué decirle al usuario, no puede ignorarlo.
 *
 * Existe por el wargaming del MVP (W3). El panel imprime la plata en `es`
 * —punto de miles, coma decimal: "1.234,00"— y el campo del colchón se
 * resolvía con `Number(texto.replace(",", "."))`. Sobre esa misma cifra, que el
 * usuario acababa de leer dos bloques más abajo, daba `NaN`: el valor se caía
 * del patch sin decir nada y la pantalla navegaba igual. Y `Number()` aceptaba
 * de contrabando lo que nadie escribe como plata (`0x10` → 16, `1e5` → 100000).
 *
 * La coma manda: si hay una, es el separador decimal y los puntos son de miles
 * ("1.234,50" → 1234,5). Sin coma, el punto es decimal, que es como llega la
 * cifra ya guardada cuando la pantalla la precarga ("1234.5" → 1234,5).
 */
export function parsePlata(texto: string): number | null {
  const limpio = texto.trim().replace(/\s/g, "");
  if (limpio === "") return null;

  const normalizado = limpio.includes(",")
    ? limpio.replace(/\./g, "").replace(",", ".")
    : limpio;

  // Forma estricta, y a propósito: `Number()` solo aceptaría hexadecimales,
  // notación científica e infinitos, que no son cifras de plata.
  if (!/^-?\d+(\.\d+)?$/.test(normalizado)) return null;

  const numero = Number(normalizado);
  return Number.isFinite(numero) ? numero : null;
}

/** Un porcentaje entero a partir de una razón 0..1 (la que devuelve el motor). */
export function formatoPorcentaje(razon: number): string {
  return `${Math.round(razon * 100)} %`;
}

/** Una fecha corta. `null` no se inventa: devuelve `null` y decide el que
 * dibuja. */
export function formatoFecha(iso: string | null): string | null {
  if (!iso) return null;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  return DIA.format(fecha);
}

/**
 * Los dos rótulos que **no** son lo mismo, y que el sistema dibuja distinto
 * (R6/X8/X11):
 *
 * - `SIN_LEER` es un campo del resumen que puede venir nulo — `card`,
 *   `next_payday`. No hay dato: no hubo resumen de tarjeta, no se configuró el
 *   día de pago.
 * - `SIN_CONFIRMAR` es una FILA con `needs_review = 1`. El dato existe y tiene
 *   monto (`db/schema.ts:13` declara `amount REAL NOT NULL`); lo que falta es
 *   que alguien lo confirme, y mientras tanto queda fuera de todos los totales.
 *
 * Confundirlos convierte "todavía no sé" en "no hay nada", que es un dato
 * falso con cara de dato.
 */
export const ROTULO_SIN_LEER = "Sin leer";
export const ROTULO_SIN_CONFIRMAR = "Sin confirmar";

/** "3 movimientos" / "1 movimiento" sin repetir el `if` en cada plantilla. */
export function plural(cantidad: number, singular: string, plural_: string): string {
  return `${formatoEntero(cantidad)} ${cantidad === 1 ? singular : plural_}`;
}
