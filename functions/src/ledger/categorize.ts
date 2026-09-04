/**
 * Copia literal de la parte PURA de `server/src/category/categorize.ts`.
 *
 * Se copia en vez de importarse por una razón de empaquetado, no de diseño:
 * `firebase deploy --only functions` sube **esta carpeta y nada más**, así que
 * un import a `../../server/src/...` compila en local y explota en el deploy.
 * Copiar es la opción honesta; lo que no se negocia es que las dos copias no
 * puedan divergir en silencio, y de eso se encarga `categorize.parity.test.ts`,
 * que importa la del server y compara las dos sobre una matriz de entradas.
 *
 * Cuando el motor entero se porte, este archivo desaparece y queda un solo
 * paquete compartido. Hasta entonces: **si tocás una, tocás la otra**.
 */

export const CATEGORIES = [
  "comida",
  "transporte",
  "salud",
  "mascota",
  "servicios",
  "recarga",
  "efectivo",
  "transferencia_persona",
  "suscripcion",
  "vivienda",
  "entretenimiento",
  "limpieza",
  "deuda",
  "prestamo",
  "regalo",
  "implementos_trabajo",
  "otros",
] as const;

export type Category = (typeof CATEGORIES)[number];

export interface CategorizeInput {
  type: string;
  counterparty?: string | null;
  is_internal?: boolean;
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export interface EstablishmentRule {
  category: Category;
  pattern: string;
}

export function matchEstablishment(
  counterparty: string | null | undefined,
  rules: readonly EstablishmentRule[]
): Category | null {
  if (!counterparty) return null;
  const normalized = normalize(counterparty);
  for (const rule of rules) {
    if (rule.pattern !== "" && normalized.includes(rule.pattern)) {
      return rule.category;
    }
  }
  return null;
}

export function toRulePattern(text: string): string {
  return normalize(text).trim();
}

export function categorize(tx: CategorizeInput, rules: readonly EstablishmentRule[] = []): Category {
  switch (tx.type) {
    case "retiro":
      return "efectivo";
    case "servicio":
      return "servicios";
    case "recarga":
      return "recarga";
    case "sueldo":
    case "recibido":
      return "otros";
    case "transferencia": {
      if (tx.is_internal) return "otros";
      const byRule = matchEstablishment(tx.counterparty, rules);
      if (byRule) return byRule;
      return tx.counterparty ? "transferencia_persona" : "otros";
    }
    default:
      break;
  }

  return matchEstablishment(tx.counterparty, rules) ?? "otros";
}

/**
 * Los dos valores que `categorize()` devuelve cuando NO sabe — la definición de
 * la cola de clasificación (`server/src/classify/queue.ts`).
 */
export const UNCLASSIFIED_CATEGORIES: ReadonlySet<Category> = new Set<Category>([
  "otros",
  "transferencia_persona",
]);
