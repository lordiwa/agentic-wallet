/**
 * El motor de estrategia — copia de `server/src/strategy/{balance,card,
 * transfers,spending}.ts`, **puro sobre filas ya leídas**.
 *
 * Todas estas funciones consumen el MISMO conjunto: los movimientos contables
 * del tenant (`countable == true`, o sea las cinco exclusiones de
 * `EXCLUDE_FROM_TOTALS_SQL` colapsadas en un booleano — ver `derive.ts`). Eso
 * no es una casualidad del puerto: en el motor las cinco consultas repiten la
 * misma cláusula, y acá se hace **una sola lectura de Firestore** de la que
 * salen los cinco indicadores.
 *
 * El costo de esa decisión, dicho en voz alta: `/overview` lee todos los
 * movimientos contables del tenant (sobre el ledger real, ~900 documentos) en
 * vez de los ~100 del mes. A cambio, ni `balanceActual` ni el promedio de
 * esenciales —que en el motor barren el ledger entero— necesitan su propia
 * consulta, y los cinco números salen por construcción del mismo conjunto en
 * vez de cinco parecidos. Con el tamaño de un ledger personal es una lectura
 * de fracciones de centavo; si algún día deja de serlo, lo que hay que cambiar
 * es esto y nada más.
 *
 * `strategy.parity.test.ts` importa el motor y compara los cinco indicadores
 * sobre los mismos ledgers.
 */
import { categorize, type Category, type EstablishmentRule } from "./categorize.js";
import type { EntradaCalendario } from "./calendar.js";
import { nextPayday, paydaysBetween } from "./calendar.js";
import { addDays, daysBetween, parseLocalDay } from "./dates.js";
import { DEFAULT_UTC_OFFSET_HOURS, fromCents, localMonthRange, toCents } from "./derive.js";
import type { StatementDoc, StrategyConfigDoc } from "./firestore-ledger.js";
import type { LedgerRow } from "./rows.js";

/**
 * `balanceActual` (§9.2): el snapshot más lo que entró menos lo que salió desde
 * entonces.
 *
 * `balanceSnapshot.at` es un día calendario sin hora y su `amount` ya refleja
 * todo hasta el final de ese día local, así que sólo cuentan los movimientos
 * estrictamente posteriores a la medianoche local del día SIGUIENTE; contar el
 * día del snapshot los contaría dos veces. Un `at` ilegible abre la ventana
 * desde la época en vez de tirar.
 */
export function balanceActual(
  contables: readonly LedgerRow[],
  config: StrategyConfigDoc,
  now: Date,
  offsetHours: number = DEFAULT_UTC_OFFSET_HOURS
): number {
  const snapshotDay = parseLocalDay(config.balanceSnapshot.at, offsetHours);
  const since = snapshotDay ? addDays(snapshotDay, 1) : new Date(0);
  const desde = since.toISOString();
  const hasta = now.toISOString();

  let deltaCents = 0;
  for (const row of contables) {
    if (row.ts < desde || row.ts > hasta) continue;
    if (row.direction === "in") deltaCents += row.amountCents;
    else if (row.direction === "out") deltaCents -= row.amountCents;
  }

  return fromCents(toCents(config.balanceSnapshot.amount) + deltaCents);
}

export interface ColchonStatus {
  objetivo: number;
  reservado: number;
  financiado: boolean;
  faltante: number;
  /** **R25**: hay una meta contra la que medir. Sin esto "no fijé objetivo" y
   * "cumplí mi objetivo" contestan idéntico. */
  fijado: boolean;
}

/** `colchonStatus` (§9.3). `reservado` en 0 cuando el usuario todavía no
 * reservó nada — que no es lo mismo que no tener colchón. */
export function colchonStatus(config: StrategyConfigDoc, reservado: number): ColchonStatus {
  const objetivoCents = toCents(config.colchonObjetivo);
  const reservadoCents = toCents(reservado);
  return {
    objetivo: fromCents(objetivoCents),
    reservado: fromCents(reservadoCents),
    financiado: reservadoCents >= objetivoCents,
    faltante: fromCents(Math.max(0, objetivoCents - reservadoCents)),
    fijado: objetivoCents > 0,
  };
}

const ESSENTIAL_TYPES = new Set(["debito", "servicio", "retiro"]);

/**
 * Promedio diario histórico de gasto esencial, en centavos: `type IN (debito,
 * servicio, retiro)` —explícitamente NO transferencia— sobre todo el ledger.
 * La ventana del promedio es el lapso entre la fila más vieja y la más nueva
 * que matchean, no el rango entero del ledger. `0` sin historial.
 *
 * Una fila con `ts` ilegible se saltea entera —ni al lapso ni al total—: sin
 * esa guarda un `NaN` se propaga hasta el número principal del Resumen.
 */
export function esencialesPromedioDiarioCents(contables: readonly LedgerRow[]): number {
  let totalCents = 0;
  let minTs: string | null = null;
  let maxTs: string | null = null;

  for (const row of contables) {
    if (!ESSENTIAL_TYPES.has(row.type) || row.direction !== "out") continue;
    if (Number.isNaN(new Date(row.ts).getTime())) continue;
    totalCents += row.amountCents;
    if (minTs === null || row.ts < minTs) minTs = row.ts;
    if (maxTs === null || row.ts > maxTs) maxTs = row.ts;
  }

  if (minTs === null || maxTs === null) return 0;

  const spanDays = Math.max(1, daysBetween(new Date(minTs), new Date(maxTs)) + 1);
  return Math.round(totalCents / spanDays);
}

export interface TarjetaStatus {
  saldoCorte: number;
  minimo: number;
  fechaMaxima: string | null;
  saldoActualEstimado: number;
  aTiempo: boolean;
  requeridoPorQuincena: number;
}

/**
 * `tarjetaStatus` (§9.5). `null` cuando no hay extracto — nunca se inventa uno.
 *
 * La comparación `ts > issueDate` es de strings, igual que en el motor: `ts` es
 * un ISO completo y `issue_date` un `YYYY-MM-DD`, y el orden lexicográfico
 * entre los dos es el orden cronológico.
 */
export function tarjetaStatus(
  statement: StatementDoc | null,
  config: StrategyConfigDoc,
  contables: readonly LedgerRow[],
  calendario: EntradaCalendario,
  now: Date,
  offsetHours: number = DEFAULT_UTC_OFFSET_HOURS
): TarjetaStatus | null {
  if (statement === null) return null;

  const saldoCorteCents = toCents(statement.balance ?? 0);
  const minimoCents = toCents(statement.minPayment ?? 0);

  let cargosNuevosCents = 0;
  if (statement.issueDate) {
    for (const row of contables) {
      if (row.type !== "credito" || row.direction !== "out") continue;
      if (row.ts > statement.issueDate) cargosNuevosCents += row.amountCents;
    }
  }

  const fechaMaxima = statement.dueDate;
  let paydaysBeforeDue = 0;
  if (fechaMaxima) {
    const dueDate = parseLocalDay(fechaMaxima, offsetHours);
    if (dueDate) paydaysBeforeDue = paydaysBetween(calendario, now, dueDate).length;
  }

  const montoEstimadoCents = toCents(config.sueldo.montoEstimado);
  const projectedIncomeCents = paydaysBeforeDue * montoEstimadoCents;

  return {
    saldoCorte: fromCents(saldoCorteCents),
    minimo: fromCents(minimoCents),
    fechaMaxima,
    saldoActualEstimado: fromCents(saldoCorteCents + cargosNuevosCents),
    aTiempo: fechaMaxima === null ? true : projectedIncomeCents >= saldoCorteCents,
    requeridoPorQuincena: fromCents(
      paydaysBeforeDue > 0 ? Math.round(saldoCorteCents / paydaysBeforeDue) : saldoCorteCents
    ),
  };
}

export interface CounterpartyTotal {
  counterparty: string;
  total: number;
}

export interface TransferenciasMesStatus {
  total: number;
  tope: number;
  restante: number;
  sobrepasado: boolean;
  topContrapartes: CounterpartyTotal[];
}

/** Cuántas contrapartes reporta `topContrapartes`. La especificación no nombra
 * un N: es un tope documentado, no una lista sin cota. */
const TOP_COUNTERPARTIES_LIMIT = 5;

/** `transferenciasMes` (§9.6): transferencias salientes a personas del mes
 * local en curso contra `topeTransferenciasMensual`. */
export function transferenciasMes(
  contables: readonly LedgerRow[],
  config: StrategyConfigDoc,
  now: Date,
  offsetHours: number = DEFAULT_UTC_OFFSET_HOURS
): TransferenciasMesStatus {
  const { from, to } = localMonthRange(now, offsetHours);
  const desde = from.toISOString();
  const hasta = to.toISOString();

  let totalCents = 0;
  const byCounterparty = new Map<string, number>();
  for (const row of contables) {
    if (row.type !== "transferencia" || row.direction !== "out" || row.isInternal) continue;
    if (row.ts < desde || row.ts >= hasta) continue;
    totalCents += row.amountCents;
    const key = row.counterparty ?? "otros";
    byCounterparty.set(key, (byCounterparty.get(key) ?? 0) + row.amountCents);
  }

  const topContrapartes = [...byCounterparty.entries()]
    .map(([counterparty, cents]) => ({ counterparty, total: fromCents(cents) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, TOP_COUNTERPARTIES_LIMIT);

  const topeCents = toCents(config.topeTransferenciasMensual);

  return {
    total: fromCents(totalCents),
    tope: fromCents(topeCents),
    restante: fromCents(topeCents - totalCents),
    sobrepasado: totalCents > topeCents,
    topContrapartes,
  };
}

/** Un movimiento de gasto con su categoría YA recalculada. */
export interface CategorizedSpendingRow {
  id: string;
  ts: string;
  amountCents: number;
  category: Category;
}

/**
 * Las filas exactas que el gráfico suma, cada una con su categoría recalculada
 * con las reglas de HOY — nunca la columna `category`, que puede estar vieja.
 *
 * Es la misma selección que consume la lista de una barra (H21): que sean la
 * misma función es lo único que garantiza que tocar una barra que dice "salud
 * 180" no muestre una lista que suma otra cosa.
 */
export function categorizedSpendingRows(
  contables: readonly LedgerRow[],
  rules: readonly EstablishmentRule[],
  periodo: { from: Date; to: Date }
): CategorizedSpendingRow[] {
  const desde = periodo.from.toISOString();
  const hasta = periodo.to.toISOString();
  const out: CategorizedSpendingRow[] = [];
  for (const row of contables) {
    if (row.direction !== "out") continue;
    if (row.ts < desde || row.ts >= hasta) continue;
    out.push({
      id: row.id,
      ts: row.ts,
      amountCents: row.amountCents,
      category: categorize(
        { type: row.type, counterparty: row.counterparty, is_internal: row.isInternal },
        rules
      ),
    });
  }
  return out;
}

/** `spending_by_category` (§9.8). Sólo aparecen las categorías con al menos una
 * fila: no se rellena el glosario con ceros. */
export function spendingByCategory(rows: readonly CategorizedSpendingRow[]): Partial<Record<Category, number>> {
  const totalsCents = new Map<Category, number>();
  for (const row of rows) {
    totalsCents.set(row.category, (totalsCents.get(row.category) ?? 0) + row.amountCents);
  }
  const result: Partial<Record<Category, number>> = {};
  for (const [category, cents] of totalsCents) result[category] = fromCents(cents);
  return result;
}

/**
 * `safeToSpendHoy` (§9.4):
 *
 *   max(0, (disponible − colchónReservado − próximoPagoTarjeta −
 *           esencialesEstimadosHastaElPróximoPago) / díasHastaElPróximoPago)
 *
 * Sin próximo pago predecible —o con uno que no está estrictamente en el
 * futuro— el presupuesto diario **no está definido**: devuelve 0 como guarda
 * contra dividir por cero, no como afirmación de que no hay plata (R7). Es la
 * diferencia que el panel dibuja distinto según `dia_de_pago_fijado`.
 */
export function safeToSpendHoy(
  contables: readonly LedgerRow[],
  config: StrategyConfigDoc,
  statement: StatementDoc | null,
  reservado: number,
  calendario: EntradaCalendario,
  now: Date,
  offsetHours: number = DEFAULT_UTC_OFFSET_HOURS
): number {
  const nextPay = nextPayday(calendario, now);
  const nextPayDate = nextPay ? parseLocalDay(nextPay, offsetHours) : null;
  if (nextPayDate === null) return 0;

  const diasHastaProximoPago = daysBetween(now, nextPayDate);
  if (diasHastaProximoPago <= 0) return 0;

  const disponibleCents = toCents(balanceActual(contables, config, now, offsetHours));
  const colchonCents = toCents(colchonStatus(config, reservado).reservado);
  const tarjeta = tarjetaStatus(statement, config, contables, calendario, now, offsetHours);
  const proximoPagoTarjetaCents = tarjeta ? toCents(tarjeta.saldoCorte) : 0;
  const esencialesCents = esencialesPromedioDiarioCents(contables) * diasHastaProximoPago;

  const numeratorCents = disponibleCents - colchonCents - proximoPagoTarjetaCents - esencialesCents;
  return Math.max(0, fromCents(Math.round(numeratorCents / diasHastaProximoPago)));
}
