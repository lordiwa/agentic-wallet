/**
 * La ingesta sobre Firestore — **el subconjunto portado**, dicho como
 * subconjunto, igual que `api/overview.ts`.
 *
 * Lo que hace, en orden: busca en Gmail desde `sinceTs`, lee cada mensaje, lo
 * pasa por el parser determinista COPIADO DEL MOTOR (`../parser/`, byte a byte,
 * ver `parser/parity.test.ts`), lo convierte al documento con
 * `toTransactionDoc` —la misma función que usó la migración, así una fila
 * ingerida hoy y una migrada ayer son indistinguibles— y lo escribe bajo
 * `users/{uid}/transactions/{gmail_msg_id}`.
 *
 * **Las tres invariantes de CLAUDE.md que esto respeta:**
 *
 * 1. *El monto sale del parser determinista.* Acá no hay ninguna otra fuente:
 *    `parseEmail` es el único que produce `amount`.
 * 2. *`amount: 0` nunca significa "no pude leerlo".* Un `amount === null` del
 *    parser se persiste como el par `(0, needsReview: true)`, exactamente como
 *    `insertTransaction` en el motor (ver `UNKNOWN_AMOUNT_PLACEHOLDER`), y esa
 *    bandera lo saca de todos los agregados.
 * 3. *Idempotente por `gmail_msg_id`.* El id del documento ES el
 *    `gmail_msg_id`, así que releer un correo ya ingerido no duplica nada. La
 *    ventana de búsqueda se abre un día antes a propósito (ver `armarQuery`) y
 *    ese solapamiento es gratis justamente por esto.
 *
 * **Lo que NO está portado**, y por eso viaja en `pendiente` de la respuesta en
 * vez de fingirse hecho:
 *
 * - `reconcile` (reversos, transferencias internas, duplicados por monto+hora):
 *   `server/src/rules/reconcile.ts`. Sin él ninguna fila se marca `isReversed`
 *   ni `isInternal` por apareo — sólo por lo que el propio parser afirma.
 * - La verificación cruzada de Claude (`amount-validate.ts`). Su ausencia NO
 *   viola la invariante 1 —el monto sigue siendo el del parser— pero sí quita
 *   una red: un monto mal leído con confianza no se marca para revisión.
 * - Los correos de estado de cuenta (`statement/ingest-statement.ts`).
 */
import type { Firestore } from "firebase-admin/firestore";
import { toTransactionDoc, type RawTransaction } from "../ledger/derive.js";
import * as paths from "../ledger/paths.js";
import { listParsers, parseEmail } from "../parser/index.js";
import type { InboundEmail } from "../parser/types.js";
import type { ClienteGmail, MensajeGmail } from "./gmail-client.js";

/** Lo mismo que `UNKNOWN_AMOUNT_PLACEHOLDER` en `server/src/db/repository.ts`:
 * cero es aceptable SOLO porque siempre viaja junto a `needs_review`. */
const MONTO_DESCONOCIDO = 0;

/** Lo que falta portar. Viaja en la respuesta para que el panel pueda decir
 * "esto todavía no se concilia" en vez de dar el lote por completo. */
export const INGESTA_PENDIENTE = [
  "reconcile",
  "verificacion-cruzada-claude",
  "estados-de-cuenta",
] as const;

export interface ResumenIngesta {
  /** Mensajes efectivamente leídos y procesados en esta corrida. */
  vistos: number;
  /** Documentos nuevos (un `gmail_msg_id` que no estaba). */
  insertados: number;
  /** Ya existían: no se tocan (invariante 3). */
  duplicados: number;
  /** Persistidos con `needsReview: true`. */
  enRevision: number;
  /** Correos que el parser clasificó como "ignorado" (avisos de login, etc.). */
  ignorados: number;
  /** Reconocidos como reverso o estado de cuenta: no se persisten todavía. */
  sinPortar: number;
  /** El `ts` más nuevo que se vio, para que el llamador avance su `sinceTs`. */
  ultimoTs: string | null;
  /**
   * Los ids de las filas que ESTE lote agregó al ledger.
   *
   * Es lo que hace posible el aviso post-sync de categoría (D7-b): "quedaron N
   * sin clasificar" lleva a la cola acotada a lo que acaba de entrar
   * (`GET /api/classify/queue?transaction_ids=`), no a la cola entera. Por lote
   * y no acumulado a propósito — la pregunta es por lo recién leído.
   */
  insertedIds: string[];
  pendiente: string[];
}

export interface OpcionesIngesta {
  /** Cota inferior ISO-8601. El llamador la lee y la avanza; este módulo no
   * toca `config/sync` — misma división que en el motor. */
  sinceTs: string;
  /** Tope de mensajes de esta corrida. Acota el costo de la función. */
  maxMensajes?: number;
}

const MAX_MENSAJES_DEFAULT = 200;

/**
 * La query de Gmail, con el día de más que el motor también se toma.
 *
 * `after:` sólo acepta una fecha (YYYY/MM/DD) y la evalúa en la zona horaria
 * de la CUENTA, no en UTC. Truncar `sinceTs` a su fecha UTC puede arrancar la
 * ventana hasta cinco horas DESPUÉS de `sinceTs` y perder en silencio los
 * correos de esa franja. Restar un día hace que la ventana siempre empiece en
 * o antes de `sinceTs`; el solapamiento no cuesta nada porque escribir es
 * idempotente.
 */
export function armarQuery(sinceTs: string, remitentes: readonly string[] = remitentesRegistrados()): string {
  const parsed = new Date(sinceTs);
  const unDiaMs = 24 * 60 * 60 * 1000;
  const fecha = Number.isNaN(parsed.getTime())
    ? sinceTs.slice(0, 10)
    : new Date(parsed.getTime() - unDiaMs).toISOString().slice(0, 10);

  // El `from:` sale de los parsers registrados y nunca está escrito a mano:
  // registrar el parser de un banco es lo que hace alcanzable a su correo.
  const desde =
    remitentes.length === 1
      ? `from:${remitentes[0]}`
      : `(${remitentes.map((r) => `from:${r}`).join(" OR ")})`;

  return `${desde} after:${fecha.replaceAll("-", "/")}`;
}

function remitentesRegistrados(): string[] {
  return [...new Set(listParsers().flatMap((p) => p.gmailSenders))];
}

function aCorreoEntrante(msg: MensajeGmail): InboundEmail {
  return {
    subject: msg.subject,
    body: msg.body,
    gmail_msg_id: msg.gmail_msg_id,
    gmail_thread_id: msg.gmail_thread_id,
    ts: msg.ts,
  };
}

export interface DepsIngesta {
  db: Firestore;
  uid: string;
  gmail: ClienteGmail;
  /** El huso del tenant, por parámetro y nunca por `process.env`: una función
   * de 2a gen atiende varias peticiones en el mismo proceso. */
  offsetHours: number;
}

export async function ingestar(deps: DepsIngesta, opciones: OpcionesIngesta): Promise<ResumenIngesta> {
  const maxMensajes = opciones.maxMensajes ?? MAX_MENSAJES_DEFAULT;
  const ids = await deps.gmail.buscarIds(armarQuery(opciones.sinceTs), maxMensajes);
  return ingestarIds(deps, ids);
}

/**
 * Ingiere una lista de ids YA elegida.
 *
 * Está separada de `ingestar` porque el drenado por lotes
 * (`ingest/sync.ts`) decide qué ids le tocan a esta llamada leyendo un
 * checkpoint, no volviendo a buscar: Gmail devuelve los mensajes **del más
 * nuevo al más viejo**, así que "buscá y procesá los primeros N" en un buzón
 * grande procesa los N más nuevos, avanza la marca al más nuevo de todos, y
 * deja el resto fuera del alcance de la siguiente búsqueda para siempre.
 */
export async function ingestarIds(deps: DepsIngesta, ids: readonly string[]): Promise<ResumenIngesta> {
  const { db, uid, gmail, offsetHours } = deps;
  paths.assertUid(uid);

  const resumen: ResumenIngesta = {
    vistos: 0,
    insertados: 0,
    duplicados: 0,
    enRevision: 0,
    ignorados: 0,
    sinPortar: 0,
    ultimoTs: null,
    insertedIds: [],
    pendiente: [...INGESTA_PENDIENTE],
  };

  const coleccion = paths.transactions(db, uid);

  for (const id of ids) {
    const msg = await gmail.leerMensaje(id);
    resumen.vistos += 1;
    if (resumen.ultimoTs === null || msg.ts > resumen.ultimoTs) resumen.ultimoTs = msg.ts;

    const resultado = parseEmail(aCorreoEntrante(msg));
    if (resultado === null || resultado.kind === "ignored") {
      resumen.ignorados += 1;
      continue;
    }
    if (resultado.kind !== "transaction") {
      // Reverso o estado de cuenta: reconocidos, pero su persistencia depende
      // de piezas que no se portaron. Se cuentan aparte en vez de contarse como
      // ignorados, que diría que el correo no importaba.
      resumen.sinPortar += 1;
      continue;
    }

    // Leer antes de escribir es lo que distingue "nuevo" de "ya estaba". Un
    // `set` a secas sería idempotente igual, pero el resumen no podría decir
    // cuánto entró de verdad, que es justo lo que el usuario pregunta.
    const ref = coleccion.doc(msg.gmail_msg_id);
    if ((await ref.get()).exists) {
      resumen.duplicados += 1;
      continue;
    }

    const montoDesconocido = resultado.amount === null || resultado.amount === undefined;
    const fila: RawTransaction = {
      gmail_msg_id: msg.gmail_msg_id,
      gmail_thread_id: msg.gmail_thread_id,
      ts: msg.ts,
      direction: resultado.direction,
      type: resultado.type,
      amount: montoDesconocido ? MONTO_DESCONOCIDO : (resultado.amount as number),
      currency: resultado.currency,
      counterparty: resultado.counterparty ?? null,
      account: resultado.account ?? null,
      account_holder: resultado.account_holder ?? null,
      // `category` es la columna HISTÓRICA. Se deja en null y la categoría que
      // se muestra la recalcula el motor con las reglas de hoy — el mismo
      // criterio que documenta `TransactionDoc.storedCategory`.
      category: null,
      raw_subject: resultado.raw_subject,
      is_reversed: 0,
      is_internal: resultado.is_internal === true ? 1 : 0,
      needs_review: resultado.needs_review || montoDesconocido ? 1 : 0,
      is_discarded: 0,
      source: "deterministic",
      created_at: new Date().toISOString(),
    };

    await ref.set(toTransactionDoc(fila, offsetHours) as unknown as Record<string, unknown>);
    resumen.insertados += 1;
    resumen.insertedIds.push(msg.gmail_msg_id);
    if (fila.needs_review === 1) resumen.enRevision += 1;
  }

  return resumen;
}
