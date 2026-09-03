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
