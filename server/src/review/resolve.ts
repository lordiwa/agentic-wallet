/**
 * La salida de `needs_review`.
 *
 * Hasta acá la cola de revisión era **de una sola dirección**: `pipeline.ts` y
 * `rules/reconcile.ts` encendían la bandera, y ningún camino del motor la
 * apagaba nunca. Eso convertía cada marca en daño permanente — la fila
 * desaparecía de todos los totales para siempre, y la única forma de sacarla
 * era editar el SQLite a mano. Con eso encima, cualquier guarda nueva que
 * marcara de más era irreversible en la práctica.
 *
 * Este módulo es la otra mitad. Tres acciones, y la diferencia entre ellas es
 * exactamente qué le pasa a la plata:
 *
 * | Acción | `needs_review` | ¿Entra a los totales? | ¿Toca el monto? |
 * |---|---|---|---|
 * | `confirm` | → 0 | **Sí**, con el monto del parser | No |
 * | `correct` | → 0 | Sí, con el monto que afirma el humano | **Sí** |
 * | `discard` | → 0 | **No** (`is_discarded = 1`) | No |
 *
 * ## La regla de oro sigue en pie
 *
 * "El monto sale del parser, nunca de Claude" no cambia acá: `correct` no es
 * una lectura automática, es **una persona afirmando un número**. Por eso la
 * única puerta por la que se escribe un monto es ésta, y sólo se abre para una
 * fila que el motor ya marcó (`needs_review = 1`). Sobre una fila sana esta
 * función no escribe nada — si lo hiciera sería un editor de montos arbitrario
 * sobre todo el ledger, y la invariante se caería por ahí.
 *
 * Dos consecuencias del mismo principio:
 *
 * - `confirm` y `discard` **rechazan** un `amount` en vez de ignorarlo. Aceptar
 *   un número y descartarlo en silencio le haría creer al humano que corrigió
 *   algo que nunca se escribió.
 * - `correct` deja la fila con `source = 'human'`. `source` es una afirmación
 *   sobre cómo se obtuvo el monto; después de una corrección manual no es ni
 *   `hybrid` ni `deterministic`.
 *
 * ## Moneda extranjera
 *
 * `confirm` **se rechaza** (`foreign_currency`) cuando la fila está en una
 * moneda distinta de `strategy_config.moneda`. Los totales suman `amount` sin
 * mirar `currency` y no hay conversión en ninguna parte, así que confirmar una
 * compra en otra moneda la haría pesar su número crudo como si fuera moneda
 * base. El parser ya marca esas filas a propósito
 * (`forceReview: true`, `reviewReason: foreign_currency_*`); esto es lo que
 * evita que la resolución deshaga esa guarda. Quedan `correct` (con el
 * equivalente convertido, que una persona afirma) y `discard`.
 *
 * ## Idempotencia
 *
 * Resolver dos veces la misma fila no hace nada la segunda vez: se devuelve
 * `changed: false` con `reason: "already_resolved"` y **no** se agrega una
 * segunda fila de auditoría. El estado que decide es el de la fila
 * (`needs_review`), no el historial: una fila que ya salió de la cola no
 * vuelve a entrar por acá.
 *
 * ## Auditoría
 *
 * Toda resolución que cambia algo deja una fila en `review_resolutions` con
 * qué, quién y cuándo — y con el monto anterior siempre, más el nuevo sólo si
 * hubo corrección. Un movimiento que reaparece en los totales sin rastro es
 * indistinguible de un bug del motor; el rastro es lo que hace usable la
 * salida.
 */
import type Database from "better-sqlite3";
import { emitMetric, withSpanSync } from "../db/telemetry.js";
import { getTransactionById, type TransactionRow } from "../db/repository.js";
import { getStrategyConfig } from "../db/strategy-config.js";

export const REVIEW_ACTIONS = ["confirm", "correct", "discard"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export interface ReviewResolutionRow {
  id: number;
  transaction_id: number;
  gmail_msg_id: string;
  action: ReviewAction;
  previous_amount: number | null;
  /** Sólo en `correct`; `null` cuando la acción no tocó plata. */
  new_amount: number | null;
  note: string | null;
  resolved_by: string;
  resolved_at: string;
}

export interface ResolveReviewInput {
  id: number;
  action: ReviewAction;
  /** Obligatorio en `correct`, prohibido en el resto. */
  amount?: number;
  note?: string;
  /** Quién resuelve. Sin esto la auditoría no sirve para nada, así que se
   * exige: cada superficie pasa su propio default (`cli`, `mcp`, `http`) o el
   * nombre que dé el usuario. */
  resolvedBy: string;
}

export interface ResolveReviewOptions {
  /** Inyectable para que los tests fijen el `resolved_at`. */
  now?: Date;
}

export type ResolveReviewError =
  | "not_found"
  | "amount_required"
  | "amount_not_allowed"
  | "invalid_amount"
  | "foreign_currency"
  | "resolved_by_required";

export type ResolveReviewResult =
  | { ok: true; changed: true; action: ReviewAction; transaction: TransactionRow; resolution: ReviewResolutionRow }
  | { ok: true; changed: false; reason: "already_resolved"; transaction: TransactionRow }
  | { ok: false; error: ResolveReviewError };

/** Un monto que una persona puede afirmar: finito y no negativo. **Cero es
 * válido** — regla 4 del CLAUDE.md: lo desconocido no es 0, es
 * `null` + `needs_review`, y de eso justamente se está saliendo acá. */
function isWritableAmount(amount: number): boolean {
  return Number.isFinite(amount) && amount >= 0;
}

/**
 * Resuelve una fila de la cola de revisión. Nunca tira: todo error es un
 * resultado tipado, para que el CLI devuelva exit code, el endpoint devuelva
 * status y la tool MCP devuelva un mensaje — cada uno mapeando el mismo
 * conjunto en vez de inventarse el suyo.
 *
 * La escritura de la fila y la de la auditoría van en una sola transacción:
 * una resolución sin rastro sería justo el estado que este módulo existe para
 * evitar.
 */
export function resolveReview(
  db: Database.Database,
  input: ResolveReviewInput,
  options: ResolveReviewOptions = {}
): ResolveReviewResult {
  return withSpanSync("review.resolve", { action: input.action }, () => {
    if (input.resolvedBy.trim() === "") return { ok: false, error: "resolved_by_required" };

    if (input.action === "correct") {
      if (input.amount === undefined) return { ok: false, error: "amount_required" };
      if (!isWritableAmount(input.amount)) return { ok: false, error: "invalid_amount" };
    } else if (input.amount !== undefined) {
      return { ok: false, error: "amount_not_allowed" };
    }

    const row = getTransactionById(db, input.id);
    if (!row) return { ok: false, error: "not_found" };
    if (row.needs_review !== 1) return { ok: true, changed: false, reason: "already_resolved", transaction: row };

    // El parser marca las compras en otra moneda a proposito
    // (`forceReview: true, reviewReason: foreign_currency_*`), porque los
    // totales suman `amount` sin mirar `currency`: no hay conversion en
    // ningun lado. Un `confirm` sobre una fila en otra moneda desharia esa
    // guarda y meteria el numero crudo a los totales como si fuera moneda
    // base -- ARS 16000 pesando como 16000 dolares distorsiona todo el
    // tablero. Se rechaza el `confirm` y quedan las dos salidas que si son
    // honestas: `correct` con el equivalente convertido (que ademas deja
    // `source = 'human'`, porque ese numero lo puso una persona) o `discard`.
    if (input.action === "confirm" && row.currency !== getStrategyConfig(db).moneda) {
      return { ok: false, error: "foreign_currency" };
    }

    const resolvedAt = (options.now ?? new Date()).toISOString();
    const newAmount = input.action === "correct" ? (input.amount as number) : null;

    const apply = db.transaction(() => {
      if (input.action === "correct") {
        // El único UPDATE de `amount` en todo el motor fuera del insert. Va
        // junto con `source = 'human'`: quién puso el número es parte del dato.
        db.prepare("UPDATE transactions SET amount = @amount, source = 'human', needs_review = 0 WHERE id = @id").run({
          amount: newAmount,
          id: row.id,
        });
      } else if (input.action === "discard") {
        db.prepare("UPDATE transactions SET needs_review = 0, is_discarded = 1 WHERE id = @id").run({ id: row.id });
      } else {
        db.prepare("UPDATE transactions SET needs_review = 0 WHERE id = @id").run({ id: row.id });
      }

      const inserted = db
        .prepare(
          `INSERT INTO review_resolutions (
             transaction_id, gmail_msg_id, action, previous_amount, new_amount, note, resolved_by, resolved_at
           ) VALUES (
             @transaction_id, @gmail_msg_id, @action, @previous_amount, @new_amount, @note, @resolved_by, @resolved_at
           )`
        )
        .run({
          transaction_id: row.id,
          gmail_msg_id: row.gmail_msg_id,
          action: input.action,
          previous_amount: row.amount,
          new_amount: newAmount,
          note: input.note ?? null,
          resolved_by: input.resolvedBy.trim(),
          resolved_at: resolvedAt,
        });

      return Number(inserted.lastInsertRowid);
    });

    const resolutionId = apply();

    // Sólo claves y conteos: ni montos, ni contrapartes, ni nombres.
    emitMetric("review.resolve.applied", { action: input.action, transaction_id: row.id });

    return {
      ok: true,
      changed: true,
      action: input.action,
      transaction: getTransactionById(db, row.id) as TransactionRow,
      resolution: db.prepare("SELECT * FROM review_resolutions WHERE id = ?").get(resolutionId) as ReviewResolutionRow,
    };
  });
}

export interface ListReviewResolutionsFilter {
  transactionId?: number;
  limit?: number;
}

/** El historial de resoluciones, más recientes primero. Sin filtro devuelve
 * todas (acotadas por `limit`); con `transactionId`, las de una sola fila. */
export function listReviewResolutions(
  db: Database.Database,
  filter: ListReviewResolutionsFilter = {}
): ReviewResolutionRow[] {
  const where = filter.transactionId === undefined ? "" : "WHERE transaction_id = @transaction_id";
  return db
    .prepare(`SELECT * FROM review_resolutions ${where} ORDER BY resolved_at DESC, id DESC LIMIT @limit`)
    .all({ transaction_id: filter.transactionId, limit: filter.limit ?? 200 }) as ReviewResolutionRow[];
}
