/**
 * La lista de movimientos de **una barra del gráfico** (H21, bien planteado).
 *
 * `docs/panel-viabilidad.md` proponía esto como un `WHERE category = ?` sobre la
 * columna. No sirve: el gráfico del Resumen **recalcula** la categoría con
 * `categorize()` + las reglas del usuario y no lee esa columna, así que el
 * filtro por columna devuelve un conjunto distinto del que la barra contó. Sobre
 * el ledger real la diferencia es de 334 filas contra 130 — tocar una barra y
 * ver otra cosa.
 *
 * Acá el filtro sale de `categorizedSpendingRows`, que es literalmente la misma
 * selección y el mismo recálculo que la barra: por construcción, la lista tiene
 * las filas que la barra contó, ni una más ni una menos.
 */
import type Database from "better-sqlite3";
import type { Category } from "../category/categorize.js";
import type { TransactionRow } from "../db/repository.js";
import { localMonthRange } from "../strategy/dates.js";
import { fromCents, toCents } from "../strategy/money.js";
import { categorizedSpendingRows, type SpendingPeriodo } from "../strategy/spending.js";

export interface MovementsByCategoryOptions {
  category: Category;
  /** El mismo `[from, to)` con el que se dibujó la barra. Sin fechas, el mes
   * local en curso — que es el período que el gráfico del Resumen dibuja
   * (`api/routes.ts`), y decidirlo acá y no en la ruta es lo que mantiene a la
   * capa HTTP sin una sola decisión sobre plata. */
  from?: Date;
  to?: Date;
  /** Sólo para fijar "el mes en curso" en un test. */
  now?: Date;
  /** Default 100, igual que `queryTransactions`. */
  limit?: number;
  offset?: number;
}

export interface MovementsByCategory {
  transactions: TransactionRow[];
  /** Cuántos movimientos tiene la categoría en el período, **antes** de
   * `limit`/`offset`: es el número que la barra contó, y sin él "cargar más" no
   * sabe si quedan. */
  total: number;
  /** La plata de la barra, para que la lista pueda mostrarla sin re-sumar. */
  amount: number;
}

export function movementsByCategory(
  db: Database.Database,
  { category, from, to, now, limit = 100, offset = 0 }: MovementsByCategoryOptions
): MovementsByCategory {
  const mes = localMonthRange(now ?? new Date());
  const periodo: SpendingPeriodo = { from: from ?? mes.from, to: to ?? mes.to };
  const matching = categorizedSpendingRows(db, periodo).filter((row) => row.category === category);
  // Más recientes primero, igual que `queryTransactions`.
  const ordered = [...matching].sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : b.id - a.id));
  const page = ordered.slice(offset, offset + limit);

  const rows =
    page.length === 0
      ? []
      : (db
          .prepare(`SELECT * FROM transactions WHERE id IN (${page.map(() => "?").join(", ")})`)
          .all(...page.map((row) => row.id)) as TransactionRow[]);

  // El orden lo fija la selección ya ordenada, no el `IN` de SQLite.
  const byId = new Map(rows.map((row) => [row.id, row]));
  const transactions = page.map((row) => byId.get(row.id)).filter((row): row is TransactionRow => row !== undefined);

  return {
    transactions,
    total: matching.length,
    amount: fromCents(matching.reduce((sum, row) => sum + toCents(row.amount), 0)),
  };
}
