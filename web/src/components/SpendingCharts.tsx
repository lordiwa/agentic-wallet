import { useEffect, useState } from "react";
import { fetchTransactions } from "../api/client";
import type { SpendingByCategory } from "../api/types";
import { currentUtcMonthRange, endOfDayIso } from "../lib/dates";
import { average, dailyTotals } from "../lib/spending";

/**
 * AC3 charts. Hand-rolled with plain divs/SVG rather than a chart library
 * (recharts et al): per the minimalism ladder (.claude/shared/MINIMALISM.md)
 * a bar-width-by-percentage list and a small inline SVG polyline satisfy
 * "grafico"/"linea" without an added dependency, a lockfile diff outside
 * this ticket's ownership, or a bundle-size cost for two simple charts.
 */

/** Bar chart of spending_by_category (from /api/overview, no separate
 * fetch/invention -- AC3 first half). */
export function SpendingByCategoryChart({ spendingByCategory }: { spendingByCategory: SpendingByCategory }) {
  const entries = Object.entries(spendingByCategory) as [string, number][];
  if (entries.length === 0) {
    return (
      <div className="card" aria-label="Gasto por categoria">
        <h3>Gasto por categoria (mes)</h3>
        <p>Sin gastos registrados este mes.</p>
      </div>
    );
  }
  const max = Math.max(...entries.map(([, amount]) => amount));
  return (
    <div className="card" aria-label="Gasto por categoria">
      <h3>Gasto por categoria (mes)</h3>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {entries
          .sort(([, a], [, b]) => b - a)
          .map(([category, amount]) => (
            <li key={category}>
              <span>
                {category}: {amount} USD
              </span>
              <div style={{ background: "#e0e0e0", height: 10, width: 200 }}>
                <div style={{ width: `${max > 0 ? (amount / max) * 100 : 0}%`, background: "#1976d2", height: 10 }} />
              </div>
            </li>
          ))}
      </ul>
    </div>
  );
}

/** Daily-spend-vs-average line chart (AC3 second half). Self-fetches
 * `/api/transactions` for the current UTC-calendar month's `direction=out`
 * rows (spending_by_category's local month range isn't reachable
 * client-side, per this ticket's web/-only file boundary -- see
 * lib/dates.ts) and aggregates them client-side with lib/spending.ts.
 * Applies the same AC4 end-of-day fix as TransactionsTable so today's
 * transactions aren't silently dropped by the `to` filter. */
export function DailySpendChart() {
  const [days, setDays] = useState<{ day: string; total: number }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const { from, to } = currentUtcMonthRange();
    fetchTransactions({ from, to: endOfDayIso(to), direction: "out", limit: 500 })
      .then((res) => {
        if (!cancelled) setDays(dailyTotals(res.transactions, from, to));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error al cargar el gasto diario");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p>Cargando gasto diario...</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!days || days.length === 0) return null;

  const totals = days.map((d) => d.total);
  const avg = average(totals);
  const max = Math.max(...totals, avg, 1);
  const width = 300;
  const height = 100;
  const stepX = days.length > 1 ? width / (days.length - 1) : 0;
  const points = days.map((d, i) => `${i * stepX},${height - (d.total / max) * height}`).join(" ");
  const avgY = height - (avg / max) * height;

  return (
    <div className="card" aria-label="Gasto diario vs promedio">
      <h3>Gasto diario vs promedio (mes)</h3>
      <p>Promedio diario: {avg.toFixed(2)} USD</p>
      <svg role="img" aria-label="Linea de gasto diario vs promedio" width={width} height={height}>
        <line x1={0} y1={avgY} x2={width} y2={avgY} stroke="#c62828" strokeDasharray="4 2" />
        <polyline points={points} fill="none" stroke="#1976d2" strokeWidth={2} />
      </svg>
    </div>
  );
}

export function SpendingCharts({ spendingByCategory }: { spendingByCategory: SpendingByCategory }) {
  return (
    <section aria-label="Graficos de gasto">
      <SpendingByCategoryChart spendingByCategory={spendingByCategory} />
      <DailySpendChart />
    </section>
  );
}
