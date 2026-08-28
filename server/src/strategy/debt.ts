/**
 * proyeccionSinDeuda (spec §9.7): months to zero out the card's saldoCorte
 * plus all pending personal debts, at a flat `abonoMensual` USD/month.
 */
import type Database from "better-sqlite3";
import { tarjetaStatus } from "./card.js";
import { localDayKey, localCalendarDate, localParts } from "./dates.js";
import { toCents } from "./money.js";

export interface ProyeccionSinDeuda {
  meses: number | null;
  fechaEstimada: string | null;
}

/**
 * proyeccionSinDeuda (spec §9.7): deuda total = tarjetaStatus().saldoCorte
 * (0 if no statement) + SUM(debts.amount WHERE status = 'pending').
 *
 * `abonoMensual` is caller-supplied -- strategy_config has no default for
 * it. When there's no debt at all, this is trivially solved: `{meses: 0,
 * fechaEstimada: today}`. When there IS debt but `abonoMensual` is missing,
 * zero, or negative, the projection is undefined -- `{meses: null,
 * fechaEstimada: null}` rather than dividing by zero or guessing a number
 * (AC9). Otherwise `meses = ceil(deuda / abonoMensual)` (a partial month
 * still needs a whole extra month) and `fechaEstimada` is `now` advanced
 * that many local calendar months.
 */
export function proyeccionSinDeuda(
  db: Database.Database,
  abonoMensual?: number,
  now: Date = new Date()
): ProyeccionSinDeuda {
  const tarjeta = tarjetaStatus(db, now);
  const saldoTarjetaCents = tarjeta ? toCents(tarjeta.saldoCorte) : 0;

  const pending = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM debts WHERE status = 'pending'").get() as {
    total: number;
  };
  const deudaTotalCents = saldoTarjetaCents + toCents(pending.total ?? 0);

  if (deudaTotalCents <= 0) {
    return { meses: 0, fechaEstimada: localDayKey(now) };
  }
  if (abonoMensual === undefined || !Number.isFinite(abonoMensual) || toCents(abonoMensual) <= 0) {
    return { meses: null, fechaEstimada: null };
  }

  const abonoCents = toCents(abonoMensual);
  const meses = Math.ceil(deudaTotalCents / abonoCents);

  const { year, monthIndex, day } = localParts(now);
  const fechaEstimada = localDayKey(localCalendarDate(year, monthIndex + meses, day));

  return { meses, fechaEstimada };
}
