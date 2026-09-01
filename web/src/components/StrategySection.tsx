import { useEffect, useState } from "react";
import { fetchOverview } from "../api/client";
import type { OverviewResponse } from "../api/types";
import { useRefreshTick } from "../lib/refresh";
import { SpendingCharts } from "./SpendingCharts";
import { StrategyCards } from "./StrategyCards";

/**
 * F2-E strategy section: fetches the extended /api/overview and renders the
 * new strategy cards + charts (AC1-AC3). Fetches independently rather than
 * sharing state with OverviewCards -- every other Dashboard section
 * (SyncButton, OverviewCards, ReviewTray, TransactionsTable) already
 * manages its own fetch/loading/error state with no shared context, so
 * matching that existing convention is the minimal change; introducing a
 * shared overview cache/context is a bigger refactor outside this ticket's
 * scope.
 */
export function StrategySection() {
  const tick = useRefreshTick();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchOverview()
      .then((res) => {
        if (cancelled) return;
        setOverview(res);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error al cargar indicadores");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  if (loading) return <p>Cargando indicadores...</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!overview) return null;

  return (
    <>
      <StrategyCards overview={overview} />
      <SpendingCharts spendingByCategory={overview.spending_by_category} />
    </>
  );
}
