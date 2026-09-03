/**
 * **Qué cambió, con el número** — F13/R19, en las dos pestañas.
 *
 * La regla que este archivo existe para cumplir es una sola y es incómoda: si
 * la pantalla promete un efecto, tiene que poder decir **cuándo el efecto es
 * cero y por qué**. Un "listo ✓" después de una acción que no movió nada es la
 * forma más barata de que alguien pierda media hora buscando el número que
 * cambió.
 *
 * Los tres casos que se dicen distinto, y de dónde sale cada uno:
 *
 * 1. **Movió, y se ve.** `reclassified > 0` con `reclassified_this_month > 0`:
 *    el gráfico del Resumen es sólo del mes en curso (`api/routes.ts`), así que
 *    hay barras que se movieron.
 * 2. **Movió, y no se ve.** `reclassified > 0` con `reclassified_this_month =
 *    0`: la regla reclasificó historial viejo. Correcto, útil, y el gráfico
 *    queda igual. Se dice.
 * 3. **No movió.** `reclassified = 0`: la regla se escribió igual —y la
 *    contraparte deja de preguntarse— pero ningún movimiento cambió de
 *    categoría.
 *
 * Ninguna de estas funciones calcula: todos los números llegan de la respuesta
 * del motor.
 */
import type { ClassifyApplyResponse, ReviewAction, ReviewResolveResponse } from "../api/types";
import { nombreCategoria } from "./categorias";
import { formatoEntero, formatoPlata, plural } from "./formato";

/** Lo que la pantalla dibuja después de una acción. `tono` elige la etiqueta
 * del sistema: `ok` cuando algo cambió, `neu` cuando no, `bad` cuando el motor
 * rechazó. */
export interface Efecto {
  tono: "ok" | "neu" | "bad";
  titulo: string;
  detalle: string;
}

/** El resultado de responder "qué es esto". */
export function efectoDeClasificar(respuesta: ClassifyApplyResponse): Efecto {
  const categoria = nombreCategoria(respuesta.category);
  const movidos = respuesta.reclassified;
  const delMes = respuesta.reclassified_this_month;

  if (movidos === 0) {
    return {
      tono: "neu",
      titulo: `La regla quedó escrita, pero no movió ningún movimiento a ${categoria}.`,
      detalle:
        "Puede ser que ya estuvieran en esa categoría, o que su tipo la decida antes que cualquier regla — un retiro es efectivo y un servicio es servicios, sin importar la contraparte. La cola de acá abajo muestra cómo quedó.",
    };
  }

  if (delMes === 0) {
    return {
      tono: "ok",
      titulo: `Reclasificaste ${plural(movidos, "movimiento", "movimientos")} a ${categoria}, ninguno de este mes.`,
      detalle:
        "El gráfico del Resumen es sólo del mes en curso, así que no vas a ver moverse ninguna barra: lo que se ordenó es historial.",
    };
  }

  // "1 movimiento, 1 de ellos de este mes" no lo dice nadie: cuando todos los
  // movidos son del mes en curso, se dice eso y no una fracción de sí misma.
  const cuantosDelMes =
    movidos === delMes
      ? movidos === 1
        ? "y es de este mes"
        : "todos de este mes"
      : `${formatoEntero(delMes)} de ellos de este mes`;

  return {
    tono: "ok",
    titulo: `Reclasificaste ${plural(movidos, "movimiento", "movimientos")} a ${categoria}, ${cuantosDelMes}.`,
    detalle: `${
      delMes === 1 ? "Ese movimiento es el que mueve" : `Esos ${formatoEntero(delMes)} son los que mueven`
    } el gráfico del Resumen, que sólo dibuja el mes en curso.`,
  };
}

/** El resultado de silenciar una contraparte (M5). */
export function efectoDeSilenciar(contraparte: string, movimientos: number, plata: number): Efecto {
  return {
    tono: "ok",
    titulo: `No se pregunta más por ${contraparte}.`,
    detalle: `${plural(movimientos, "movimiento", "movimientos")} por ${formatoPlata(
      plata
    )} salen de la cola. Su plata cuenta como cubierta en el progreso: cerrar la pregunta también es responderla.`,
  };
}

/**
 * **R12: qué hace cada acción con el total.** Se dice ANTES de tocar el botón,
 * no después.
 *
 * Descartar es la que hay que decir en voz alta: `review/resolve.ts` escribe
 * `is_discarded = 1`, y `strategy/totals.ts` excluye tanto `needs_review = 1`
 * como `is_discarded = 1`. O sea que la fila no vuelve a los totales — no
 * "vuelve con monto cero". Si la pantalla no lo dice, descartar parece la
 * salida rápida y es la única de las tres que borra plata del tablero.
 */
export const QUE_HACE_CADA_ACCION: Record<ReviewAction, string> = {
  confirm: "El monto entra a los totales tal como está y el movimiento vuelve al saldo y al gasto por categoría.",
  correct: "El monto que escribas reemplaza al del parser, queda marcado como puesto por vos, y entra a los totales.",
  discard: "La fila queda excluida para siempre. NO suma en el saldo ni en ningún total — descartar no mueve el saldo.",
};

/**
 * El resultado de resolver una fila de monto.
 *
 * **R13: `changed:false` no es éxito.** El motor devuelve `{ok:true,
 * changed:false, reason:"already_resolved"}` con status 200 cuando la fila ya
 * estaba resuelta (otra pestaña, el CLI, la tool MCP). Mirar sólo `ok` haría
 * que la pantalla festeje una acción que no ocurrió y muestre un número que no
 * cambió.
 */
export function efectoDeResolver(respuesta: ReviewResolveResponse): Efecto {
  if (!respuesta.changed) {
    return {
      tono: "neu",
      titulo: "Esto ya lo resolviste en otro lado.",
      detalle:
        "La fila salió de la cola antes de que tocaras el botón — desde otra pestaña, el CLI o la tool MCP. No se escribió nada nuevo; la lista se refresca para que veas cómo quedó.",
    };
  }

  const monto = respuesta.transaction.amount;

  if (respuesta.action === "discard") {
    return {
      tono: "ok",
      titulo: "Movimiento descartado.",
      detalle: `Sale de la cola y NO entra a los totales: el saldo no se mueve por esto. Quedó el rastro de quién lo descartó y cuándo.`,
    };
  }

  if (respuesta.action === "correct") {
    return {
      tono: "ok",
      titulo: `Monto corregido a ${formatoPlata(monto)}.`,
      detalle:
        "El movimiento vuelve a los totales con ese número, marcado como puesto por vos y no por el parser. Ya suma en el saldo y en el gasto por categoría.",
    };
  }

  return {
    tono: "ok",
    titulo: `Monto confirmado en ${formatoPlata(monto)}.`,
    detalle: "El movimiento vuelve a los totales: ya suma en el saldo y en el gasto por categoría.",
  };
}

/**
 * El rechazo del motor, con su motivo — nunca un rojo genérico
 * (`c2-tarjeta-revision.html`). Un código que este panel no conoce se muestra
 * tal cual: es más honesto que traducirlo a "algo salió mal".
 */
const MOTIVOS: Record<string, string> = {
  foreign_currency:
    "Este movimiento está en otra moneda que la de tu perfil, y el motor suma los montos sin convertir: confirmarlo metería el número crudo a los totales como si fuera moneda base. Las salidas son corregirlo con el equivalente convertido, o descartarlo.",
  not_found: "El motor no encontró esta fila. Probablemente ya no está en la cola: refrescá la lista.",
  amount_required: "Corregir necesita un monto.",
  amount_not_allowed: "Esta acción no lleva monto.",
  invalid_amount: "Ese monto no se puede escribir: tiene que ser un número finito y no negativo. Cero sí es válido.",
  counterparty_not_found:
    "El motor no encontró esa contraparte en el ledger, así que no escribió ninguna regla. Una regla que no corresponde a una contraparte real no clasificaría una sola fila.",
  empty_pattern: "El nombre de la contraparte quedó vacío después de normalizarlo: no hay patrón que escribir.",
};

export function motivoDelMotor(codigo: string): string {
  return MOTIVOS[codigo] ?? `El motor rechazó esto: ${codigo}`;
}

export function efectoDeRechazo(codigo: string): Efecto {
  return { tono: "bad", titulo: "El motor rechazó esto.", detalle: motivoDelMotor(codigo) };
}
