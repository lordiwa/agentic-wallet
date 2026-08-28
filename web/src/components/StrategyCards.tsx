import type { OverviewResponse } from "../api/types";
import { daysUntil } from "../lib/countdown";

/**
 * New F2-E strategy cards (AC1) plus the two countdowns (AC2). Every figure
 * is read straight off the extended /api/overview payload (F2-D) -- never
 * recomputed or guessed here -- and each card renders an explicit
 * "sin datos" message rather than inventing a number when its source is
 * null/unavailable, mirroring OverviewCards' existing convention.
 */

/** safe_to_spend_hoy always comes back as a number (0 when the engine has
 * no predictable next payday to budget against, per
 * server/src/strategy/balance.ts) -- that 0 is indistinguishable from a
 * "there is data and it's zero" case unless read alongside next_payday, so
 * this card treats "no next_payday" as its own "sin datos" state instead of
 * displaying a bare, easily-misread 0. */
export function SafeToSpendCard({ overview }: { overview: OverviewResponse }) {
  const { safe_to_spend_hoy, next_payday } = overview;
  return (
    <div className="card" aria-label="Safe to spend hoy">
      <h3>Safe to spend hoy</h3>
      {next_payday !== null ? (
        <p>{safe_to_spend_hoy} USD/dia</p>
      ) : (
        <p>Sin datos suficientes (no hay proxima fecha de pago).</p>
      )}
    </div>
  );
}

export function ColchonProgressCard({ overview }: { overview: OverviewResponse }) {
  const { objetivo, reservado, financiado, faltante } = overview.buffer_status;
  if (objetivo <= 0) {
    return (
      <div className="card" aria-label="Colchon">
        <h3>Colchon</h3>
        <p>Sin objetivo de colchon configurado.</p>
      </div>
    );
  }
  const pct = Math.min(100, Math.round((reservado / objetivo) * 100));
  return (
    <div className="card" aria-label="Colchon">
      <h3>Colchon</h3>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{ background: "#e0e0e0", height: 8, width: 200 }}
      >
        <div style={{ width: `${pct}%`, background: financiado ? "#2e7d32" : "#1976d2", height: 8 }} />
      </div>
      <p>
        {reservado} / {objetivo} USD ({pct}%) - {financiado ? "Financiado" : `Faltan ${faltante} USD`}
      </p>
    </div>
  );
}

export function CardStatusCard({ overview }: { overview: OverviewResponse }) {
  const status = overview.card_status;
  if (!status) {
    return (
      <div className="card" aria-label="Estado de tarjeta">
        <h3>Estado de tarjeta</h3>
        <p>Sin estado de cuenta aun.</p>
      </div>
    );
  }

  const dias = daysUntil(status.fechaMaxima);

  return (
    <div className="card" aria-label="Estado de tarjeta">
      <h3>Estado de tarjeta</h3>
      <p data-testid="tarjeta-semaforo" style={{ color: status.aTiempo ? "#2e7d32" : "#c62828" }}>
        {status.aTiempo ? "A tiempo" : "En riesgo"}
      </p>
      <dl>
        <dt>Saldo del corte</dt>
        <dd>{status.saldoCorte}</dd>
        <dt>Minimo</dt>
        <dd>{status.minimo}</dd>
        <dt>Saldo actual estimado</dt>
        <dd>{status.saldoActualEstimado}</dd>
        <dt>Requerido por quincena</dt>
        <dd>{status.requeridoPorQuincena}</dd>
        <dt>Fecha maxima de pago</dt>
        <dd>
          {status.fechaMaxima ?? "-"}
          {dias !== null && ` (${dias >= 0 ? `en ${dias} dias` : `hace ${-dias} dias`})`}
        </dd>
      </dl>
    </div>
  );
}

export function TransfersVsTopeCard({ overview }: { overview: OverviewResponse }) {
  const { total, tope, restante, sobrepasado, topContrapartes } = overview.transfers_summary;
  return (
    <div className="card" aria-label="Transferencias del mes">
      <h3>Transferencias del mes</h3>
      <p>
        {total} / {tope} USD - Restante: {restante} USD
      </p>
      {sobrepasado && <p role="alert">Tope de transferencias del mes superado.</p>}
      {topContrapartes.length > 0 && (
        <ul>
          {topContrapartes.map((c) => (
            <li key={c.counterparty}>
              {c.counterparty}: {c.total} USD
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function NextPaydayCard({ overview }: { overview: OverviewResponse }) {
  const dias = daysUntil(overview.next_payday);
  return (
    <div className="card" aria-label="Proximo pago">
      <h3>Proximo pago</h3>
      {overview.next_payday !== null && dias !== null ? (
        <p>
          {overview.next_payday} ({dias >= 0 ? `en ${dias} dias` : `hace ${-dias} dias`})
        </p>
      ) : (
        <p>Sin fecha de proximo pago conocida.</p>
      )}
    </div>
  );
}

export function StrategyCards({ overview }: { overview: OverviewResponse }) {
  return (
    <section aria-label="Indicadores de estrategia">
      <SafeToSpendCard overview={overview} />
      <ColchonProgressCard overview={overview} />
      <CardStatusCard overview={overview} />
      <TransfersVsTopeCard overview={overview} />
      <NextPaydayCard overview={overview} />
    </section>
  );
}
