/**
 * `GET /api/overview` sobre Firestore — **el subconjunto portado**, dicho como
 * subconjunto.
 *
 * El `buildOverview` del server (`server/src/api/routes.ts:103`) devuelve nueve
 * campos. Acá hay cinco. Los otros cuatro (`safe_to_spend_hoy`, `card_status`,
 * `transfers_summary`, `next_payday`) dependen de partes del motor que todavía
 * no se portaron, y la decisión explícita es **no devolverlos** en vez de
 * devolver un cero.
 *
 * Un `safe_to_spend_hoy: 0` es una cifra que el usuario puede creer, y sería
 * mentira: el motor devuelve 0 cuando no hay próximo pago predecible, no cuando
 * nadie escribió el cálculo. Por eso el payload lleva `pendiente`, la lista
 * literal de lo que falta. Es la misma regla que el `fijado` de `colchonStatus`
 * (R25): "no lo sé" y "es cero" no pueden contestar igual.
 */
import type { Category } from "../ledger/categorize.js";
import { fromCents, localMonthKey } from "../ledger/derive.js";
import type { FirestoreLedger } from "../ledger/firestore-ledger.js";

export interface OverviewBalance {
  amount: number;
  currency: string;
  at: string | null;
}

export interface OverviewCard {
  card_mask: string | null;
  issue_date: string | null;
  balance: number | null;
  min_payment: number | null;
  due_date: string | null;
}

export interface OverviewColchon {
  objetivo: number;
  reservado: number;
  financiado: boolean;
  faltante: number;
  /** Hay una meta contra la que medir. Ver `strategy/balance.ts` (R25). */
  fijado: boolean;
}

export interface FirebaseOverview {
  balance: OverviewBalance | null;
  card: OverviewCard | null;
  counts: { total: number; needs_review: number };
  buffer_status: OverviewColchon;
  spending_by_category: Partial<Record<Category, number>>;
  /** Los campos del overview del motor que esta versión todavía no calcula. */
  pendiente: string[];
}

/** Lo que falta portar. Viaja en la respuesta a propósito: el panel puede
 * decidir no dibujar esas tarjetas en vez de dibujarlas en cero. */
export const OVERVIEW_PENDIENTE = [
  "safe_to_spend_hoy",
  "card_status",
  "transfers_summary",
  "next_payday",
] as const;

export async function buildFirebaseOverview(
  ledger: FirestoreLedger,
  now: Date = new Date()
): Promise<FirebaseOverview> {
  const config = await ledger.strategyConfig();
  const month = localMonthKey(now.toISOString(), config.utcOffsetHours);

  const [counts, statement, reservado, spendingRows] = await Promise.all([
    ledger.counts(),
    ledger.latestStatement(),
    ledger.colchonReservado(),
    month === null ? Promise.resolve([]) : ledger.spendingRowsForMonth(month),
  ]);

  // Se suma en centavos y se convierte una sola vez al final, igual que
  // `spendingByCategory`: sumar floats y redondear al final da otro número.
  const centsByCategory = new Map<Category, number>();
  for (const row of spendingRows) {
    centsByCategory.set(row.category, (centsByCategory.get(row.category) ?? 0) + row.amountCents);
  }
  const spending_by_category: Partial<Record<Category, number>> = {};
  for (const [category, cents] of centsByCategory) {
    spending_by_category[category] = fromCents(cents);
  }

  const objetivo = config.colchonObjetivo;

  return {
    balance:
      config.balanceSnapshot.at === "" && config.balanceSnapshot.amount === 0
        ? null
        : {
            amount: config.balanceSnapshot.amount,
            currency: config.moneda,
            at: config.balanceSnapshot.at === "" ? null : config.balanceSnapshot.at,
          },
    card: statement
      ? {
          card_mask: statement.cardMask,
          issue_date: statement.issueDate,
          balance: statement.balance,
          min_payment: statement.minPayment,
          due_date: statement.dueDate,
        }
      : null,
    counts: { total: counts.total, needs_review: counts.needsReview },
    buffer_status: {
      objetivo,
      reservado,
      financiado: reservado >= objetivo,
      faltante: Math.max(0, fromCents(Math.round(objetivo * 100) - Math.round(reservado * 100))),
      fijado: objetivo > 0,
    },
    spending_by_category,
    pendiente: [...OVERVIEW_PENDIENTE],
  };
}
