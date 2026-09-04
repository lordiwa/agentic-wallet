/**
 * `GET /api/overview` sobre Firestore — **completo**, ya no un subconjunto.
 *
 * La primera versión de este archivo devolvía cinco de los nueve campos del
 * `buildOverview` del motor y publicaba los otros cuatro en un array
 * `pendiente`, para que el panel pudiera no dibujar esas tarjetas en vez de
 * dibujarlas en cero. Ese array ya no existe porque ya no falta nada:
 * `safe_to_spend_hoy`, `card_status`, `transfers_summary` y `next_payday` los
 * calcula el motor portado (`ledger/strategy.ts`, `ledger/calendar.ts`) con la
 * misma aritmética, verificada contra el original en los tests de paridad.
 *
 * Lo que **no** cambió y sigue gobernando: un cero es una afirmación. Un
 * `safe_to_spend_hoy: 0` sigue significando lo que significa en el motor —no
 * hay próximo pago predecible, así que el presupuesto diario no está definido
 * (R7)— y el panel lo distingue de "hay cero pesos" mirando
 * `next_payday`/`dia_de_pago_fijado`, no adivinando. Igual el `fijado` del
 * colchón (R25).
 *
 * **Una sola lectura del ledger.** Los cinco indicadores salen del mismo
 * conjunto de movimientos contables (ver el doc de `ledger/strategy.ts`), así
 * que este handler hace una consulta y reparte, en vez de cinco consultas
 * parecidas que podrían empezar a diferir.
 */
import type { Category } from "../ledger/categorize.js";
import type { EntradaCalendario } from "../ledger/calendar.js";
import { nextPayday } from "../ledger/calendar.js";
import { localMonthRange } from "../ledger/derive.js";
import type { FirestoreLedger } from "../ledger/firestore-ledger.js";
import {
  categorizedSpendingRows,
  colchonStatus,
  safeToSpendHoy,
  spendingByCategory,
  tarjetaStatus,
  transferenciasMes,
  type ColchonStatus,
  type TarjetaStatus,
  type TransferenciasMesStatus,
} from "../ledger/strategy.js";

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

export interface FirebaseOverview {
  balance: OverviewBalance | null;
  card: OverviewCard | null;
  counts: { total: number; needs_review: number };
  safe_to_spend_hoy: number;
  buffer_status: ColchonStatus;
  card_status: TarjetaStatus | null;
  transfers_summary: TransferenciasMesStatus;
  next_payday: string | null;
  spending_by_category: Partial<Record<Category, number>>;
}

export async function buildFirebaseOverview(
  ledger: FirestoreLedger,
  now: Date = new Date()
): Promise<FirebaseOverview> {
  const config = await ledger.strategyConfig();
  const offsetHours = config.utcOffsetHours;

  const [counts, statement, reservado, contables, rules, historicalDays] = await Promise.all([
    ledger.counts(),
    ledger.latestStatement(),
    ledger.colchonReservado(),
    ledger.countableRows(),
    ledger.rules(),
    ledger.diasDeSueldo(offsetHours),
  ]);

  const calendario: EntradaCalendario = {
    diasPago: config.sueldo.diasPago,
    historicalDays,
    offsetHours,
  };

  const mes = localMonthRange(now, offsetHours);

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
    safe_to_spend_hoy: safeToSpendHoy(
      contables,
      config,
      statement,
      reservado,
      calendario,
      now,
      offsetHours
    ),
    buffer_status: colchonStatus(config, reservado),
    card_status: tarjetaStatus(statement, config, contables, calendario, now, offsetHours),
    transfers_summary: transferenciasMes(contables, config, now, offsetHours),
    next_payday: nextPayday(calendario, now),
    spending_by_category: spendingByCategory(categorizedSpendingRows(contables, rules, mes)),
  };
}
