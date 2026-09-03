/**
 * La mecánica de la cola de preguntas: **orden, saltos y páginas**. Nada de
 * esto calcula plata — los totales, el progreso y los grupos llegan del motor
 * (regla 4 de §2.3 del plan). Lo que se decide acá es en qué orden se muestran
 * y cuántos entran en una pantalla.
 *
 * Vive fuera del componente por la misma razón por la que el motor de N1 vive
 * fuera de la pantalla: son tres reglas con nombre y con test, y adentro de un
 * `.vue` no se pueden probar sin montar un navegador.
 */
import type { ClassifyGroupRow, ClassifyProgressResponse } from "../api/types";
import { formatoEntero, formatoPlata, formatoPorcentaje } from "./formato";

/**
 * Cuántos grupos entran en una página.
 *
 * **W5/R15: la cola se pagina desde el día 1.** La condición que el plan
 * aceptaba ("el día que pase de ~200 filas") ya se cumplió: son 334 filas en
 * 151 contrapartes. Veinte es lo que entra en una pantalla sin scroll infinito
 * y es más que las 30 respuestas que cubren el 80 % de la plata: el criterio de
 * terminado de M1 se alcanza en la segunda página, no en la octava.
 */
export const TAMANO_PAGINA = 20;

/**
 * La cola en el orden en que se pregunta: **por plata descendente**, que es el
 * orden en que la manda el motor, con las salteadas al final.
 *
 * *Saltar* no descarta ni silencia: manda la tarjeta al final de la cola y ahí
 * queda, con su plata intacta en el progreso. Es la única acción de las tres
 * que no escribe nada en el server — y por eso el conjunto de salteadas vive en
 * la pantalla y se pierde al recargar, que es exactamente lo que uno espera de
 * "después la veo".
 *
 * Entre las salteadas se conserva el orden por plata: saltar dos no las mezcla.
 */
export function ordenarCola(
  grupos: readonly ClassifyGroupRow[],
  salteadas: ReadonlySet<string> = new Set()
): ClassifyGroupRow[] {
  if (salteadas.size === 0) return [...grupos];
  const activas = grupos.filter((grupo) => !salteadas.has(grupo.pattern));
  const alFinal = grupos.filter((grupo) => salteadas.has(grupo.pattern));
  return [...activas, ...alFinal];
}

export interface Pagina<T> {
  items: T[];
  /** 1-based, como se lee: "página 2 de 8". */
  numero: number;
  paginas: number;
  /** El índice del primer y del último elemento, 1-based, para "21–40 de 151". */
  desde: number;
  hasta: number;
  total: number;
}

/**
 * Una página. El número pedido se acota a lo que existe: responder la última
 * contraparte de la página 8 no puede dejar la pantalla en una página vacía
 * mirando la nada.
 */
export function paginar<T>(items: readonly T[], numero: number, tamano: number = TAMANO_PAGINA): Pagina<T> {
  const paginas = Math.max(1, Math.ceil(items.length / tamano));
  const actual = Math.min(Math.max(1, Math.trunc(numero) || 1), paginas);
  const inicio = (actual - 1) * tamano;
  const trozo = items.slice(inicio, inicio + tamano);
  return {
    items: trozo,
    numero: actual,
    paginas,
    desde: items.length === 0 ? 0 : inicio + 1,
    hasta: inicio + trozo.length,
    total: items.length,
  };
}

/** Lo que la barra de progreso dibuja y dice. */
export interface VistaProgreso {
  /** 0..100 — cuánta plata ya está cubierta. Es el ancho de la barra. */
  ancho: number;
  /** La frase principal, siempre visible. */
  titulo: string;
  /** El detalle de abajo: qué falta, o por qué ya alcanza. */
  detalle: string;
  /** M1: se llegó al 80 % de la plata. La pantalla celebra acá, no en cero
   * filas. */
  celebra: boolean;
}

/**
 * El progreso **por plata**, que está siempre visible (H35, **M1**).
 *
 * Por qué no se cuenta en filas: con 151 contrapartes "quedan 118" no distingue
 * la que mueve 312 de la que movió 1,20 una sola vez, y deja al usuario
 * midiendo su avance con una regla que no significa nada. Por eso la frase que
 * el plan sella es *"te queda el 47 % de tu plata sin clasificar · 30
 * respuestas más"*: las dos mitades son plata, no filas.
 *
 * Y por qué se celebra al 80 % y no al vacío: con 90 contrapartes de una sola
 * fila, cero es un estado que nadie alcanza en una tarde. `done` lo decide el
 * motor (`classify/progress.ts`), no esta función — acá sólo se escribe.
 */
export function vistaProgreso(progreso: ClassifyProgressResponse): VistaProgreso {
  const ancho = Math.min(100, Math.max(0, Math.round(progreso.covered_ratio * 100)));

  if (progreso.done) {
    return {
      ancho,
      celebra: true,
      titulo: `Cubriste el ${formatoPorcentaje(progreso.covered_ratio)} de tu plata`,
      detalle:
        progreso.groups === 0
          ? "No queda ninguna contraparte por responder."
          : `Quedan ${formatoEntero(progreso.groups)} contrapartes por ${formatoPlata(
              progreso.unclassified_total
            )}. Respondelas si querés: para que los números signifiquen algo, ya alcanza.`,
    };
  }

  return {
    ancho,
    celebra: false,
    titulo: `Te queda el ${formatoPorcentaje(progreso.unclassified_ratio)} de tu plata sin clasificar`,
    detalle: `${formatoEntero(progreso.answers_to_target)} ${
      progreso.answers_to_target === 1 ? "respuesta más cubre" : "respuestas más cubren"
    } ${formatoPlata(progreso.amount_to_target)} y llegás al ${formatoPorcentaje(progreso.target_ratio)} de tu plata.`,
  };
}

/**
 * Las contrapartes de la cola que además tienen movimientos esperando que se
 * confirme su monto.
 *
 * Es el orden entre pestañas hecho dato. Una **fila** nunca está en las dos
 * colas —`selectClassifiableRows` excluye `needs_review = 1`, porque un monto
 * sin afirmar no suma en el orden por plata ni movería un gráfico—, pero una
 * **contraparte** sí: dos movimientos del mismo comercio, uno esperando monto y
 * otro esperando categoría. Ahí el monto se pregunta primero, y la tarjeta de
 * categoría lo dice en vez de dejar que el usuario descubra después que su
 * respuesta no contó toda la plata que veía.
 *
 * La comparación se hace contra `grupo.pattern`, que **es** la contraparte
 * pasada por `toRulePattern` en el motor. Por eso esta función lo reproduce
 * exactamente —NFD, sin marcas diacríticas, minúsculas, `trim`— y no "algo
 * parecido": si normalizara distinto, las dos pestañas hablarían de la misma
 * contraparte con dos claves y el aviso no aparecería nunca.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function contrapartesConMontoPendiente(
  filasDeMonto: readonly { counterparty: string | null }[]
): Map<string, number> {
  const cuenta = new Map<string, number>();
  for (const fila of filasDeMonto) {
    const clave = normalizar(fila.counterparty ?? "");
    if (clave === "") continue;
    cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1);
  }
  return cuenta;
}
