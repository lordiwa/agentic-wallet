/**
 * La fila que las piezas puras del motor consumen, y su traducción desde un
 * documento de Firestore.
 *
 * Existe para que el puerto tenga **una sola frontera**: `firestore-ledger.ts`
 * hace consultas y devuelve `LedgerRow[]`; todo lo que decide plata
 * (`queue.ts`, `strategy.ts`, `recurring.ts`) recibe filas y no sabe que
 * Firestore existe. Es lo que hace que los tests de paridad puedan darle las
 * MISMAS filas a la copia y al motor SQL y comparar la salida sin montar una
 * base a cada lado.
 *
 * Dos diferencias con la fila del motor, y ninguna es de gusto:
 *
 * - **`id` es un string**, el `gmail_msg_id`, que es el id del documento. El
 *   `INTEGER` de SQLite no apunta a nada acá: viaja como `legacyId` sólo para
 *   auditar la migración (ver `derive.ts`), y usarlo como identidad dejaría sin
 *   id a toda fila ingerida después del pivot.
 * - **`amountCents` en centavos enteros.** El motor guarda el float y convierte
 *   al sumar; acá el documento ya está en centavos (`TransactionDoc`), así que
 *   la conversión se hace una vez, al reportar.
 */
import type { TransactionDoc } from "./derive.js";
import { fromCents } from "./derive.js";

/** Lo mínimo que las funciones puras necesitan de un movimiento. */
export interface LedgerRow {
  /** El `gmail_msg_id` — el id del documento. Ver el doc del módulo. */
  id: string;
  ts: string;
  type: string;
  direction: string;
  counterparty: string | null;
  isInternal: boolean;
  amountCents: number;
}

export function toLedgerRow(doc: TransactionDoc): LedgerRow {
  return {
    id: doc.gmailMsgId,
    ts: doc.ts,
    type: doc.type,
    direction: doc.direction,
    counterparty: doc.counterparty,
    isInternal: doc.isInternal,
    amountCents: doc.amountCents,
  };
}

/**
 * El documento completo, serializado con los nombres `snake_case` de la API del
 * motor (`TransactionRow` de `server/src/db/repository.ts`), que es lo que el
 * panel ya sabe leer.
 *
 * `id` sale del `gmailMsgId` y **no** del `legacyId`: ver el doc del módulo. El
 * panel lo trata como opaco —lo usa de clave de lista y lo devuelve en
 * `POST /review/:id/resolve`— así que un string sirve igual que un entero, y a
 * diferencia del entero existe para toda fila.
 */
export interface SerializedTransaction {
  id: string;
  gmail_msg_id: string;
  gmail_thread_id: string | null;
  ts: string;
  direction: string;
  type: string;
  amount: number;
  currency: string;
  counterparty: string | null;
  account: string | null;
  category: string | null;
  raw_subject: string | null;
  is_reversed: number;
  is_internal: number;
  needs_review: number;
  is_discarded: number;
  source: string;
  created_at: string;
}

export function serializeTransaction(doc: TransactionDoc): SerializedTransaction {
  return {
    id: doc.gmailMsgId,
    gmail_msg_id: doc.gmailMsgId,
    gmail_thread_id: doc.gmailThreadId,
    ts: doc.ts,
    direction: doc.direction,
    type: doc.type,
    amount: fromCents(doc.amountCents),
    currency: doc.currency,
    counterparty: doc.counterparty,
    account: doc.account,
    // La columna HISTÓRICA, igual que en el motor. La categoría que el panel
    // muestra la recalcula el gráfico; ésta viaja para no cambiar la forma de
    // la respuesta que el panel ya sabe leer.
    category: doc.storedCategory,
    raw_subject: doc.rawSubject,
    is_reversed: doc.isReversed ? 1 : 0,
    is_internal: doc.isInternal ? 1 : 0,
    needs_review: doc.needsReview ? 1 : 0,
    is_discarded: doc.isDiscarded ? 1 : 0,
    source: doc.source,
    created_at: doc.createdAt,
  };
}
