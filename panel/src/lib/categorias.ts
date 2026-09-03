/**
 * Cómo se escriben las diez categorías del glosario
 * (`server/src/category/categorize.ts`). Es traducción, no clasificación: acá
 * no se decide qué categoría le toca a nada — eso lo hace el motor, y el panel
 * dibuja lo que le llega.
 *
 * La lista es cerrada porque la del motor lo es. Una categoría que no esté acá
 * se dibuja con su propia clave antes que con un nombre inventado: si el motor
 * suma una, se ve fea hasta que alguien la nombre, que es mejor que verse bien
 * y estar mal.
 */
import type { Category } from "../api/types";

const NOMBRES: Record<Category, string> = {
  comida: "Comida",
  transporte: "Transporte",
  salud: "Salud",
  mascota: "Mascota",
  servicios: "Servicios",
  recarga: "Recarga",
  efectivo: "Efectivo",
  transferencia_persona: "Transferencia a persona",
  suscripcion: "Suscripción",
  otros: "Otros",
};

export function nombreCategoria(clave: string): string {
  return NOMBRES[clave as Category] ?? clave;
}

export interface BarraCategoria {
  clave: string;
  nombre: string;
  total: number;
  /** 0..100 — el ancho de la barra, relativo a la categoría más grande. Es
   * geometría del dibujo, no un total: los totales llegan del motor. */
  ancho: number;
}

/**
 * Las barras del gráfico, de la que más plata mueve a la que menos. Una
 * categoría en cero **se dibuja**: cero es un valor real (regla 1 de §2.3), y
 * es distinto de no aparecer (el motor sólo manda las categorías que tuvieron
 * al menos una fila).
 */
export function barrasDeCategoria(gasto: Record<string, number | undefined>): BarraCategoria[] {
  const entradas = Object.entries(gasto).filter(([, total]) => typeof total === "number") as [string, number][];
  const maximo = entradas.reduce((max, [, total]) => Math.max(max, total), 0);

  return entradas
    .sort((a, b) => b[1] - a[1])
    .map(([clave, total]) => ({
      clave,
      nombre: nombreCategoria(clave),
      total,
      ancho: maximo > 0 ? Math.round((total / maximo) * 100) : 0,
    }));
}

/**
 * Las categorías que una pregunta del panel puede ofrecer: el glosario cerrado
 * del motor **menos sus dos fallbacks**. `otros` es literalmente "no sé" y
 * `transferencia_persona` es "es una transferencia con contraparte", que es
 * exactamente el estado del que la pregunta existe para salir; ofrecerlos sería
 * ofrecer "responder que no sabés", y para eso ya está *No preguntarme más*
 * (M5).
 *
 * Vive acá y no en un componente porque la usan dos: la tarjeta de la cola
 * (N3) y la de un gasto fijo propuesto (N4), y son la misma pregunta hecha
 * sobre dos poblaciones.
 */
export const CATEGORIAS_ELEGIBLES: Category[] = [
  "comida",
  "transporte",
  "salud",
  "mascota",
  "servicios",
  "recarga",
  "efectivo",
  "suscripcion",
];

export interface OpcionCategoria {
  clave: Category;
  nombre: string;
}

/** Las mismas, ya con su nombre para dibujar. */
export function opcionesDeCategoria(): OpcionCategoria[] {
  return CATEGORIAS_ELEGIBLES.map((clave) => ({ clave, nombre: nombreCategoria(clave) }));
}
