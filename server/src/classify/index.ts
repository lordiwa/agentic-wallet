/**
 * El motor de la pregunta (fase N1 de `docs/plan-final-mvp.md`): todo lo que la
 * cola de clasificación necesita saber, sin una sola línea de pantalla.
 *
 * Cuatro piezas, cada una con su porqué en su propio archivo:
 * `queue.ts` (la cola agrupada por contraparte, H32), `apply.ts` (el escritor,
 * H28/M4), `silenced.ts` (la salida honesta, H33/M5) y `progress.ts` (el
 * progreso por plata y el criterio de terminado, H35/M1). `movements.ts` es el
 * filtro por categoría recalculada de la lista de movimientos (H21).
 */
export * from "./queue.js";
export * from "./apply.js";
export * from "./silenced.js";
export * from "./progress.js";
export * from "./movements.js";
