/**
 * La tarjeta de entrada al análisis del historial, decidida acá y no en la
 * plantilla del Resumen.
 *
 * **Por qué es una tarjeta del Resumen y no una bifurcación antes del hogar**
 * (criterio 9 del ticket): P1 nunca bloqueó a nadie, y ponerla antes del hogar
 * la convertiría en un peaje. Lo que el Escenario 2 necesita es que el análisis
 * *exista y se encuentre*, no que se imponga.
 *
 * Tres reglas, y las tres son sobre no mentir:
 *
 * 1. **Sin respuesta del motor no se dibuja.** Un server anterior a N4 no tiene
 *    la ruta; una tarjeta que lleva a una pantalla que va a fallar es peor que
 *    ninguna tarjeta (§2.5, regla 4: lo que no tiene backend no se dibuja).
 * 2. **Con el trabajo hecho la tarjeta se va.** Si no quedan propuestas y los
 *    dos campos del perfil están fijados, no hay nada que ofrecer, y seguir
 *    diciendo "todavía no leí tus gastos fijos" sería falso.
 * 3. **El freno de los 3 meses se anuncia en la tarjeta** (R33), no sólo
 *    adentro: el usuario tiene que poder saber por qué todavía no hay nada que
 *    confirmar sin entrar a averiguarlo.
 */
import type { RecurringResponse } from "../api/types";
import { formatoEntero, plural } from "./formato";

export interface EntradaGastosFijos {
  /** La lectura del motor, o `null` si no contestó. */
  recurring: RecurringResponse | null;
  /** Hay día de pago configurado (`next_payday` del Resumen no es null). */
  hayDiaDePago: boolean;
  /** R25: hay un colchón objetivo mayor que cero. */
  colchonFijado: boolean;
}

export interface TarjetaGastosFijos {
  visible: boolean;
  /** El titular de la tarjeta. */
  titulo: string;
  /** La línea de contexto: siempre con un número, nunca una promesa vaga. */
  nota: string;
  tag: { clase: "acc" | "warn" | "neu"; texto: string } | null;
}

const OCULTA: TarjetaGastosFijos = { visible: false, titulo: "", nota: "", tag: null };

/**
 * Que lo recibido tenga de verdad la forma del contrato. Un server viejo puede
 * contestar `200` con otra cosa —o con la carga de otra ruta— y una tarjeta
 * armada sobre campos ausentes diría "llevás undefined meses". Si no se
 * entiende la respuesta, no se dibuja: es la misma regla que con el 404.
 */
function esRespuesta(valor: RecurringResponse | null): valor is RecurringResponse {
  return (
    valor !== null &&
    Array.isArray(valor.propuestas) &&
    Number.isFinite(valor.meses_de_historial) &&
    Number.isFinite(valor.meses_minimos) &&
    typeof valor.suficiente_historial === "boolean"
  );
}

/** "2,5 meses" sin arrastrar el ",0" de un entero. */
function meses(cantidad: number): string {
  const redondo = Number.isInteger(cantidad);
  return `${redondo ? formatoEntero(cantidad) : cantidad.toLocaleString("es", { maximumFractionDigits: 1 })} ${
    cantidad === 1 ? "mes" : "meses"
  }`;
}

/** Qué le falta al perfil, dicho como lo que se pierde por no tenerlo. */
function faltaDelPerfil(entrada: EntradaGastosFijos): string | null {
  if (!entrada.hayDiaDePago && !entrada.colchonFijado) {
    return "faltan tu día de pago y tu colchón objetivo";
  }
  if (!entrada.hayDiaDePago) return "falta tu día de pago, y sin él no hay safe-to-spend";
  if (!entrada.colchonFijado) return "falta tu colchón objetivo, y sin él el anillo no mide nada";
  return null;
}

export function tarjetaGastosFijos(entrada: EntradaGastosFijos): TarjetaGastosFijos {
  const { recurring } = entrada;
  if (!esRespuesta(recurring)) return OCULTA;

  const falta = faltaDelPerfil(entrada);

  if (!recurring.suficiente_historial) {
    return {
      visible: true,
      titulo: "Todavía no leí tus gastos fijos",
      nota: `llevás ${meses(recurring.meses_de_historial)} de historial · con ${meses(
        recurring.meses_minimos
      )} puedo leerlos${falta ? ` · ${falta}` : ""}`,
      tag: { clase: "warn", texto: "historial corto" },
    };
  }

  if (recurring.propuestas.length > 0) {
    const cola =
      recurring.en_la_cola > 0
        ? ` · ${plural(recurring.en_la_cola, "más queda", "más quedan")} en la cola`
        : "";
    return {
      visible: true,
      titulo: "Todavía no leí tus gastos fijos",
      nota: `encontré ${plural(recurring.propuestas.length, "gasto fijo", "gastos fijos")} en tu historial${cola}`,
      tag: { clase: "acc", texto: "listo para revisar" },
    };
  }

  if (falta === null) return OCULTA;

  return {
    visible: true,
    titulo: "Falta un dato de tu perfil",
    nota: `no encontré gastos fijos nuevos, pero ${falta}`,
    tag: { clase: "warn", texto: "sin fijar" },
  };
}
