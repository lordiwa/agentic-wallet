/**
 * **R25 — un objetivo en cero es un objetivo SIN FIJAR, no uno cumplido.**
 *
 * `strategy/balance.ts` calcula `financiado = reservado >= objetivo`, y
 * `0 >= 0` es verdadero. La consecuencia es concreta y está en el ledger de
 * cualquiera que acaba de instalar esto: un usuario nuevo, con cero reservado y
 * sin haber configurado nada, ve el anillo lleno, en verde, *financiado*. La
 * respuesta de "no fijé objetivo" es **idéntica campo por campo** a la de
 * "cumplí mi objetivo" —las dos dicen `financiado: true, faltante: 0`— y lo
 * único que las distingue es el objetivo en cero.
 *
 * Por qué se arregla acá y no en el motor: `colchonStatus` es la fórmula de la
 * especificación (§9.3) y tiene sus tests; cambiar qué significa `financiado`
 * ahí movería el brief, el chat y MCP por una decisión que es de la pantalla.
 * Lo que la pantalla necesita no es otra fórmula, es **no dibujar una barra
 * llena cuando no hay meta contra la que compararse**, y eso es esta función.
 *
 * Pura y sin dependencias: recibe lo que el motor calculó y decide cómo se
 * dibuja. No suma, no promedia, no deriva plata.
 */
import type { ColchonStatus } from "../api/types";

export interface VistaColchon {
  /** Hay una meta contra la que medir. Con `false` no hay porcentaje que valga. */
  fijado: boolean;
  /** Sólo tiene sentido con `fijado`. Sin meta, nadie financió nada. */
  financiado: boolean;
  /** 0..100. Con el objetivo sin fijar es 0: no hay contra qué medir. */
  ancho: number;
  /** Lo que dice la barra: "Financiado", "Sin financiar", "Sin fijar". */
  etiqueta: string;
  /** La clase de la etiqueta de estado del sistema (§2.1). */
  tag: "ok" | "warn" | "neu";
}

export const SIN_FIJAR = "Sin fijar";

/**
 * Cómo se dibuja el colchón. `null` —el motor todavía no contestó— se trata
 * como sin fijar y no como cero: la diferencia entre "no sé" y "no hay" es la
 * misma que separa `Sin leer` de `0,00` en todo el panel.
 */
export function vistaColchon(colchon: ColchonStatus | null | undefined): VistaColchon {
  if (!colchon || colchon.objetivo <= 0) {
    return { fijado: false, financiado: false, ancho: 0, etiqueta: SIN_FIJAR, tag: "neu" };
  }

  const ancho = Math.min(100, Math.max(0, Math.round((colchon.reservado / colchon.objetivo) * 100)));
  return {
    fijado: true,
    financiado: colchon.financiado,
    ancho,
    etiqueta: colchon.financiado ? "Financiado" : "Sin financiar",
    tag: colchon.financiado ? "ok" : "warn",
  };
}
