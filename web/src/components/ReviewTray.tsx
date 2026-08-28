import { useEffect, useState } from "react";
import { fetchReview } from "../api/client";
import type { TransactionRow } from "../api/types";

/** needs_review tray (AC2): lists /api/review, most recent first (server-sorted). */
export function ReviewTray() {
  const [transactions, setTransactions] = useState<TransactionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchReview()
      .then((res) => {
        if (!cancelled) setTransactions(res.transactions);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error al cargar la bandeja de revision");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section aria-labelledby="review-heading">
      <h2 id="review-heading">Necesitan revision</h2>
      {loading && <p>Cargando...</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && transactions && transactions.length === 0 && <p>Nada pendiente de revision.</p>}
      {!loading && !error && transactions && transactions.length > 0 && (
        <ul>
          {transactions.map((t) => (
            <li key={t.id}>
              {t.ts} - {t.counterparty ?? "Sin contraparte"} - {t.amount} {t.currency}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
