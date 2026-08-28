/**
 * tarjetaStatus (spec §9.5): a snapshot of the latest credit-card statement
 * plus a payability projection against upcoming paydays.
 */
import type Database from "better-sqlite3";
import type { StatementRow } from "../db/repository.js";
import { getStrategyConfig } from "../db/strategy-config.js";
import { paydaysBetween } from "./calendar.js";
import { parseLocalDay } from "./dates.js";
import { fromCents, toCents } from "./money.js";
import { EXCLUDE_FROM_TOTALS_SQL } from "./totals.js";

export interface TarjetaStatus {
  saldoCorte: number;
  minimo: number;
  fechaMaxima: string | null;
  saldoActualEstimado: number;
  aTiempo: boolean;
  requeridoPorQuincena: number;
}

function latestStatement(db: Database.Database): StatementRow | undefined {
  return db.prepare("SELECT * FROM statements ORDER BY issue_date DESC, id DESC LIMIT 1").get() as
    | StatementRow
    | undefined;
}

/** Sum of new `'credito'`-type charges strictly after (calendar-day
 * inclusive of) `issueDate`, i.e. spend not yet reflected in the
 * statement's `saldoCorte`. Transactions carry no card_mask link, so --
 * consistent with "the latest statement" being treated as the single card
 * -- every qualifying 'credito' row after the cutoff is attributed to it. */
function newChargesCents(db: Database.Database, issueDate: string): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) as total FROM transactions
       WHERE type = 'credito' AND direction = 'out' AND ts > @issueDate AND ${EXCLUDE_FROM_TOTALS_SQL}`
    )
    .get({ issueDate }) as { total: number };
  return toCents(row.total ?? 0);
}

/**
 * tarjetaStatus (spec §9.5). Returns `null` when there is no statement yet
 * -- never invents one.
 *
 *  - saldoCorte / minimo / fechaMaxima come straight from the latest
 *    `statements` row (by issue_date, ties broken by id).
 *  - saldoActualEstimado = saldoCorte + newChargesCents(issue_date): what's
 *    likely owed today, ahead of the *next* statement.
 *  - requeridoPorQuincena = saldoCorte / (number of predicted paydays
 *    strictly after `now` and on/before fechaMaxima). Divide-by-zero guard:
 *    zero such paydays (or no fechaMaxima at all) -> the whole saldoCorte is
 *    "required" in one shot, since there's no quincena left to spread it
 *    over.
 *  - aTiempo = true when the projected paycheck income before fechaMaxima
 *    (paydays-before-due * sueldo.montoEstimado) covers saldoCorte, or when
 *    there's no fechaMaxima to miss in the first place. This is the
 *    resolved reading of "can the corte balance be paid before fechaMaxima
 *    with the remaining paychecks before that date": literally, will the
 *    money from those paychecks be enough.
 */
export function tarjetaStatus(db: Database.Database, now: Date = new Date()): TarjetaStatus | null {
  const statement = latestStatement(db);
  if (!statement) return null;

  const config = getStrategyConfig(db);
  const saldoCorteCents = toCents(statement.balance ?? 0);
  const minimoCents = toCents(statement.min_payment ?? 0);
  const saldoActualEstimadoCents = saldoCorteCents + (statement.issue_date ? newChargesCents(db, statement.issue_date) : 0);

  const fechaMaxima = statement.due_date;
  let paydaysBeforeDue = 0;
  if (fechaMaxima) {
    const dueDate = parseLocalDay(fechaMaxima);
    if (dueDate) paydaysBeforeDue = paydaysBetween(db, now, dueDate).length;
  }

  const montoEstimadoCents = toCents(config.sueldo.montoEstimado);
  const projectedIncomeCents = paydaysBeforeDue * montoEstimadoCents;
  const aTiempo = fechaMaxima === null ? true : projectedIncomeCents >= saldoCorteCents;
  const requeridoPorQuincenaCents = paydaysBeforeDue > 0 ? Math.round(saldoCorteCents / paydaysBeforeDue) : saldoCorteCents;

  return {
    saldoCorte: fromCents(saldoCorteCents),
    minimo: fromCents(minimoCents),
    fechaMaxima,
    saldoActualEstimado: fromCents(saldoActualEstimadoCents),
    aTiempo,
    requeridoPorQuincena: fromCents(requeridoPorQuincenaCents),
  };
}
