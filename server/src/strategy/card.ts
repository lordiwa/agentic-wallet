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

/**
 * El plan de pago de la tarjeta. Los `null` **no son opcionales de estilo**:
 * cada uno marca un campo del extracto que el parser no pudo leer, y por lo
 * tanto una pregunta que el plan no puede contestar (CLAUDE.md regla 4).
 *
 * Antes esta interfaz era toda de tipos no-nulos y cada hueco se rellenaba con
 * un cero o un `true`. Eso convertía "no sé" en una afirmación: `minimo: 0` se
 * lee "no tenés que pagar nada" y `aTiempo: true` se lee "vas bien". El panel
 * ya se había defendido de esto esquivando `card_status` entero y leyendo el
 * extracto crudo (`panel/src/views/Resumen.vue`, `saldoDeTarjeta`); acá se
 * arregla en la fuente, así el resto de los consumidores —el brief, el
 * dashboard viejo, las tools MCP— dejan de recibir la misma mentira.
 */
export interface TarjetaStatus {
  saldoCorte: number;
  /** `null` = el extracto no traía "Monto mínimo a pagar". */
  minimo: number | null;
  fechaMaxima: string | null;
  /** `null` = sin fecha de emisión no se puede saber qué consumos son
   * posteriores al corte, así que no hay estimación que dar. */
  saldoActualEstimado: number | null;
  /** `null` = no hay fecha máxima contra la cual estar (o no) a tiempo. */
  aTiempo: boolean | null;
  /** `null` = sin fecha máxima no hay quincenas entre hoy y el vencimiento
   * sobre las cuales repartir el saldo. */
  requeridoPorQuincena: number | null;
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
 *    `statements` row (by issue_date, ties broken by id). `minimo` stays
 *    `null` when the statement didn't carry one -- `0` would be a claim.
 *  - saldoActualEstimado = saldoCorte + newChargesCents(issue_date): what's
 *    likely owed today, ahead of the *next* statement. `null` without an
 *    issue_date: "charges after the cutoff" needs a cutoff, and answering
 *    `saldoCorte` there silently reports zero new spending.
 *  - requeridoPorQuincena = saldoCorte / (number of predicted paydays
 *    strictly after `now` and on/before fechaMaxima). With a fechaMaxima but
 *    zero paydays before it the whole saldoCorte is "required" in one shot --
 *    that IS the answer, not a guard. Without a fechaMaxima there's no
 *    horizon at all, so it's `null`.
 *  - aTiempo = true when the projected paycheck income before fechaMaxima
 *    (paydays-before-due * sueldo.montoEstimado) covers saldoCorte. This is
 *    the resolved reading of "can the corte balance be paid before
 *    fechaMaxima with the remaining paychecks before that date": literally,
 *    will the money from those paychecks be enough. Without a fechaMaxima
 *    it's `null` -- it used to be `true` ("nothing to be late for"), which on
 *    a card carrying four thousand dollars reads as reassurance and silently
 *    disarmed the brief's `tarjeta_riesgo_atraso` alert.
 */
export function tarjetaStatus(db: Database.Database, now: Date = new Date()): TarjetaStatus | null {
  const statement = latestStatement(db);
  if (!statement) return null;

  const config = getStrategyConfig(db);
  const saldoCorteCents = toCents(statement.balance ?? 0);
  const minimoCents = statement.min_payment === null ? null : toCents(statement.min_payment);
  const saldoActualEstimadoCents =
    statement.issue_date === null ? null : saldoCorteCents + newChargesCents(db, statement.issue_date);

  const fechaMaxima = statement.due_date;
  let paydaysBeforeDue = 0;
  if (fechaMaxima) {
    const dueDate = parseLocalDay(fechaMaxima);
    if (dueDate) paydaysBeforeDue = paydaysBetween(db, now, dueDate).length;
  }

  const montoEstimadoCents = toCents(config.sueldo.montoEstimado);
  const projectedIncomeCents = paydaysBeforeDue * montoEstimadoCents;
  const aTiempo = fechaMaxima === null ? null : projectedIncomeCents >= saldoCorteCents;
  const requeridoPorQuincenaCents =
    fechaMaxima === null ? null : paydaysBeforeDue > 0 ? Math.round(saldoCorteCents / paydaysBeforeDue) : saldoCorteCents;

  return {
    saldoCorte: fromCents(saldoCorteCents),
    minimo: minimoCents === null ? null : fromCents(minimoCents),
    fechaMaxima,
    saldoActualEstimado: saldoActualEstimadoCents === null ? null : fromCents(saldoActualEstimadoCents),
    aTiempo,
    requeridoPorQuincena: requeridoPorQuincenaCents === null ? null : fromCents(requeridoPorQuincenaCents),
  };
}
