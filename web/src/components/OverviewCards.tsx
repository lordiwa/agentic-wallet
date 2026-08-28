import { useEffect, useState } from "react";
import { fetchOverview } from "../api/client";
import type { OverviewResponse } from "../api/types";

/**
 * Saldo/tarjeta/conteos snapshot (AC3). Renders only figures that come back
 * from /api/overview — balance/card render an explicit "sin datos" message
 * rather than a guessed number when the API returns null (unseeded state).
 */
export function OverviewCards() {
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchOverview()
      .then((res) => {
        if (!cancelled) setOverview(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error al cargar el resumen");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p>Cargando resumen...</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!overview) return null;

  const { balance, card, counts } = overview;

  return (
    <section aria-label="Resumen">
      <div className="card" aria-label="Saldo">
        <h3>Saldo</h3>
        {balance ? (
          <p>
            {balance.amount} {balance.currency}
            {balance.at ? ` (al ${balance.at})` : ""}
          </p>
        ) : (
          <p>Sin datos de saldo aun.</p>
        )}
      </div>

      <div className="card" aria-label="Tarjeta">
        <h3>Tarjeta</h3>
        {card ? (
          <dl>
            <dt>Tarjeta</dt>
            <dd>{card.card_mask ?? "-"}</dd>
            <dt>Fecha de corte</dt>
            <dd>{card.issue_date ?? "-"}</dd>
            <dt>Saldo del corte</dt>
            <dd>{card.balance ?? "-"}</dd>
            <dt>Pago minimo</dt>
            <dd>{card.min_payment ?? "-"}</dd>
            <dt>Fecha maxima de pago</dt>
            <dd>{card.due_date ?? "-"}</dd>
          </dl>
        ) : (
          <p>Sin estado de cuenta aun.</p>
        )}
      </div>

      <div className="card" aria-label="Conteos">
        <h3>Transacciones</h3>
        <p>
          Total: {counts.total} - Por revisar: {counts.needs_review}
        </p>
      </div>
    </section>
  );
}
