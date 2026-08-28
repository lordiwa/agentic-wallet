import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { fetchTransactions } from "../api/client";
import type { TransactionRow, TransactionsFilter } from "../api/types";
import { endOfDayIso } from "../lib/dates";

// Mirrors server/src/api/schemas.ts TRANSACTION_TYPES.
const TRANSACTION_TYPES = [
  "debito",
  "credito",
  "transferencia",
  "servicio",
  "retiro",
  "recarga",
  "sueldo",
  "recibido",
] as const;

/** One page's worth of rows requested from the server (AC5: an explicit,
 * known limit is what lets the UI detect "there may be more results"). */
const PAGE_SIZE = 50;

/**
 * Strips empty-string form values so they aren't sent as filter params, and
 * fixes AC4: `draft.to` is a bare "YYYY-MM-DD" from the date input, but the
 * server's `to` filter is a plain string comparison (`ts <= @to`) that would
 * exclude same-day transactions carrying a time component unless pushed to
 * the end of that day (see lib/dates.ts endOfDayIso for the full reasoning).
 */
function cleanFilter(draft: TransactionsFilter): TransactionsFilter {
  const out: TransactionsFilter = {};
  if (draft.from) out.from = draft.from;
  if (draft.to) out.to = endOfDayIso(draft.to);
  if (draft.type) out.type = draft.type;
  if (draft.direction) out.direction = draft.direction;
  if (draft.counterparty) out.counterparty = draft.counterparty;
  return out;
}

/**
 * Transactions table with from/to/type/direction/counterparty filters
 * (AC1), an end-inclusive "Hasta" filter (AC4), and a fixed-size page with
 * prev/next + an over-the-limit notice (AC5) since /api/transactions'
 * `count` field is just the returned page size, not a total match count --
 * there is no server-side "total matches" to report, so a full page is the
 * signal that more rows may exist beyond it.
 */
export function TransactionsTable() {
  const [draft, setDraft] = useState<TransactionsFilter>({});
  const [filter, setFilter] = useState<TransactionsFilter>({});
  const [offset, setOffset] = useState(0);
  const [transactions, setTransactions] = useState<TransactionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTransactions({ ...filter, limit: PAGE_SIZE, offset })
      .then((res) => {
        if (!cancelled) setTransactions(res.transactions);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error al cargar transacciones");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filter, offset]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilter(cleanFilter(draft));
    setOffset(0);
  }

  function handleReset() {
    setDraft({});
    setFilter({});
    setOffset(0);
  }

  const hasMore = !!transactions && transactions.length === PAGE_SIZE;

  return (
    <section aria-labelledby="transactions-heading">
      <h2 id="transactions-heading">Transacciones</h2>

      <form onSubmit={handleSubmit}>
        <label htmlFor="tx-from">
          Desde
          <input
            id="tx-from"
            type="date"
            value={draft.from ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value || undefined }))}
          />
        </label>
        <label htmlFor="tx-to">
          Hasta
          <input
            id="tx-to"
            type="date"
            value={draft.to ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value || undefined }))}
          />
        </label>
        <label htmlFor="tx-type">
          Tipo
          <select
            id="tx-type"
            value={draft.type ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value || undefined }))}
          >
            <option value="">Todos</option>
            {TRANSACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="tx-direction">
          Direccion
          <select
            id="tx-direction"
            value={draft.direction ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, direction: e.target.value || undefined }))}
          >
            <option value="">Todas</option>
            <option value="in">Entrada</option>
            <option value="out">Salida</option>
          </select>
        </label>
        <label htmlFor="tx-counterparty">
          Contraparte
          <input
            id="tx-counterparty"
            type="text"
            aria-describedby="tx-counterparty-hint"
            value={draft.counterparty ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, counterparty: e.target.value || undefined }))}
          />
        </label>
        {/* AC5: the server matches counterparty exactly (server/src/api/queries.ts
            `counterparty = @counterparty`), not a partial/substring match -- this
            ticket's file boundary is web/-only, so the UI states that instead of
            claiming a partial match it can't deliver. Kept outside the <label> so
            the label's accessible name stays just "Contraparte" for existing
            getByLabelText("Contraparte") callers. */}
        <span id="tx-counterparty-hint">(coincidencia exacta)</span>
        <button type="submit">Filtrar</button>
        <button type="button" onClick={handleReset}>
          Limpiar
        </button>
      </form>

      {loading && <p>Cargando transacciones...</p>}
      {error && <p role="alert">{error}</p>}
      {!loading && !error && transactions && transactions.length === 0 && <p>No hay transacciones.</p>}
      {!loading && !error && transactions && transactions.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Tipo</th>
              <th>Direccion</th>
              <th>Contraparte</th>
              <th>Monto</th>
              <th>Revisar</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((t) => (
              <tr key={t.id}>
                <td>{t.ts}</td>
                <td>{t.type}</td>
                <td>{t.direction}</td>
                <td>{t.counterparty ?? "-"}</td>
                <td>
                  {t.amount} {t.currency}
                </td>
                <td>{t.needs_review ? "Si" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!loading && !error && transactions && (
        <div>
          {hasMore && <p>Mostrando los primeros {PAGE_SIZE} resultados. Puede haber mas -- usa "Siguiente".</p>}
          <button type="button" onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))} disabled={offset === 0}>
            Anterior
          </button>
          <button type="button" onClick={() => setOffset((o) => o + PAGE_SIZE)} disabled={!hasMore}>
            Siguiente
          </button>
        </div>
      )}
    </section>
  );
}
