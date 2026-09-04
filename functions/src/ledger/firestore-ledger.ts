/**
 * La capa de datos del ledger sobre Firestore.
 *
 * Lo que este archivo NO hace, a propósito: **no calcula plata**. Devuelve
 * filas, conteos y documentos; quién los suma son `strategy.ts`, `queue.ts` y
 * `recurring.ts`, que son las copias verificadas del motor. La regla que se
 * está protegiendo es la misma que separa `db/repository.ts` de `strategy/` en
 * el motor: si acá empieza a haber aritmética financiera, la invariante deja de
 * tener un solo dueño.
 *
 * Las decisiones que explican la forma de cada método:
 *
 * 1. **Todo colgado de `uid`**, que viene del token verificado (`paths.ts`).
 * 2. **Se filtra por los campos derivados** (`countable`, `month`,
 *    `queueEligible`, `pattern`), no por los cinco booleanos crudos. Ver
 *    `derive.ts` para el porqué.
 * 3. **La categoría se recalcula en la función, no se lee de Firestore.** La
 *    columna `storedCategory` viaja para poder auditar la migración y para
 *    dejar el ledger consistente con lo que el gráfico muestra, pero lo que se
 *    muestra sale siempre de `categorize()` + las reglas de HOY: una regla que
 *    el usuario acaba de escribir tiene que mover la barra sin un backfill.
 * 4. **Lo que el motor resuelve con `LIKE`/`GROUP BY` se resuelve leyendo y
 *    filtrando en memoria**, y cada vez que eso pasa el método dice cuánto
 *    cuesta. Firestore no tiene subcadena ni agrupación; fingir que sí, con un
 *    campo materializado por consulta, sería inventar una segunda definición de
 *    cada regla.
 */
import type { DocumentData, Firestore, Query } from "firebase-admin/firestore";
import type { Category, EstablishmentRule } from "./categorize.js";
import { categorize, toRulePattern, UNCLASSIFIED_CATEGORIES } from "./categorize.js";
import {
  DEFAULT_UTC_OFFSET_HOURS,
  fromCents,
  isCountable,
  localDayKey,
  toCents,
  type TransactionDoc,
} from "./derive.js";
import * as paths from "./paths.js";
import { toLedgerRow, type LedgerRow } from "./rows.js";

/** La config de estrategia, con los mismos nombres y defaults que
 * `server/src/seed/default-config.ts`. Un tenant recién creado la tiene toda
 * en cero/vacío: CLAUDE.md regla 3. */
export interface StrategyConfigDoc {
  moneda: string;
  zonaHoraria: string;
  utcOffsetHours: number;
  colchonObjetivo: number;
  topeTransferenciasMensual: number;
  titular: string;
  sueldo: {
    fuente: string;
    cadencia: string;
    montoEstimado: number;
    diasPago: string[];
  };
  balanceSnapshot: { amount: number; at: string };
}

export const DEFAULT_STRATEGY_CONFIG: StrategyConfigDoc = {
  moneda: "USD",
  zonaHoraria: "",
  utcOffsetHours: DEFAULT_UTC_OFFSET_HOURS,
  colchonObjetivo: 0,
  topeTransferenciasMensual: 0,
  titular: "",
  sueldo: { fuente: "", cadencia: "", montoEstimado: 0, diasPago: [] },
  balanceSnapshot: { amount: 0, at: "" },
};

export interface StatementDoc {
  gmailMsgId: string | null;
  cardMask: string | null;
  issueDate: string | null;
  balance: number | null;
  minPayment: number | null;
  dueDate: string | null;
}

export interface LedgerCounts {
  total: number;
  needsReview: number;
}

/** Una contraparte silenciada. Espejo de `SilencedCounterparty`. */
export interface SilencedCounterparty {
  pattern: string;
  counterparty: string;
  created_at: string;
}

/** El estado del sync que `GET /api/sync/status` publica. */
export interface SyncStateDoc {
  lastSyncTs: string | null;
  /** Cuándo arrancó el sync que está corriendo, o `null` si no hay ninguno.
   * Ver `tomarGuardaDeSync`. */
  runningSince: string | null;
  backlog: { processed: number; total: number; remaining: number; updated_at: string } | null;
}

/** El rastro de una resolución de la cola de monto. */
export interface ReviewResolutionDoc {
  id: string;
  transaction_id: string;
  gmail_msg_id: string;
  action: string;
  previous_amount: number | null;
  new_amount: number | null;
  note: string | null;
  resolved_by: string;
  resolved_at: string;
}

/** Los campos que las consultas de plata proyectan. Menos bytes por documento;
 * el conteo de lecturas facturadas no cambia, pero la latencia sí. */
const CAMPOS_DE_FILA = [
  "gmailMsgId",
  "ts",
  "type",
  "direction",
  "counterparty",
  "isInternal",
  "amountCents",
] as const;

function docsALedgerRows(docs: readonly FirebaseFirestore.QueryDocumentSnapshot[]): LedgerRow[] {
  return docs.map((doc) => toLedgerRow(doc.data() as TransactionDoc));
}

/**
 * Recalcula los campos derivados que dependen de las banderas de una fila.
 *
 * Se llama después de toda escritura que toque `needsReview`, `isDiscarded` o
 * el monto. **Sin esto una fila confirmada nunca vuelve a los totales**:
 * `countable` es la materialización de las cinco exclusiones y quedaría en
 * `false` para siempre, con `needsReview` ya en `false`. Es el precio de
 * materializar, y se paga acá, en un solo lugar.
 *
 * Lo que NO recalcula, porque no cambia: `month`, `day`, `pattern` y
 * `baseCategory` sólo dependen de `ts`, la contraparte y el tipo.
 */
export function recomputarDerivados(doc: TransactionDoc): TransactionDoc {
  const countable = isCountable({
    is_internal: doc.isInternal ? 1 : 0,
    is_reversed: doc.isReversed ? 1 : 0,
    needs_review: doc.needsReview ? 1 : 0,
    is_discarded: doc.isDiscarded ? 1 : 0,
    type: doc.type,
  });
  return {
    ...doc,
    countable,
    queueEligible:
      countable &&
      doc.direction === "out" &&
      doc.pattern !== null &&
      UNCLASSIFIED_CATEGORIES.has(doc.baseCategory),
  };
}

export interface TransactionsFilter {
  /** Instante ISO inclusive. Ya traducido de día local por `dates.ts`. */
  from?: string;
  /** Instante ISO **inclusive**, igual que el `ts <= @to` del motor. */
  to?: string;
  type?: string;
  direction?: string;
  counterparty?: string;
  limit?: number;
  offset?: number;
}

export class FirestoreLedger {
  constructor(
    private readonly db: Firestore,
    private readonly uid: string
  ) {
    paths.assertUid(uid);
  }

  /**
   * La config del tenant. Un tenant sin documento devuelve los defaults en
   * vez de tirar: una billetera recién creada no está rota, está vacía, y el
   * panel tiene que poder dibujarla.
   */
  async strategyConfig(): Promise<StrategyConfigDoc> {
    const snap = await paths.configDoc(this.db, this.uid, "strategy").get();
    if (!snap.exists) return { ...DEFAULT_STRATEGY_CONFIG };
    const data = snap.data() as Partial<StrategyConfigDoc>;
    return {
      ...DEFAULT_STRATEGY_CONFIG,
      ...data,
      sueldo: { ...DEFAULT_STRATEGY_CONFIG.sueldo, ...(data.sueldo ?? {}) },
      balanceSnapshot: { ...DEFAULT_STRATEGY_CONFIG.balanceSnapshot, ...(data.balanceSnapshot ?? {}) },
    };
  }

  /** Escribe SÓLO las claves presentes: el colchón y el día de pago se fijan en
   * momentos distintos y ninguno pisa al otro. */
  async writeStrategyConfig(patch: Partial<StrategyConfigDoc>): Promise<void> {
    await paths.configDoc(this.db, this.uid, "strategy").set(patch, { merge: true });
  }

  /**
   * Total de movimientos y cuántos esperan revisión.
   *
   * Usa `count()` (agregación server-side): se factura una lectura por cada
   * 1000 documentos contados, no una por documento.
   */
  async counts(): Promise<LedgerCounts> {
    const col = paths.transactions(this.db, this.uid);
    const [total, needsReview] = await Promise.all([
      col.count().get(),
      col.where("needsReview", "==", true).count().get(),
    ]);
    return { total: total.data().count, needsReview: needsReview.data().count };
  }

  /**
   * Las reglas de comercio del usuario, **de patrón más largo a más corto**.
   *
   * El orden no es cosmético y no es "el de escritura": `matchEstablishment`
   * devuelve la PRIMERA que matchea, así que `"farmacia san jose"` tiene que
   * ganarle a un `"farmacia"` más viejo. Es exactamente el
   * `ORDER BY LENGTH(pattern) DESC, pattern ASC` de `listCategoryRules`, y
   * ordenar por `createdAt` —como hacía la primera versión de este método—
   * hacía que el overview portado clasificara distinto que el motor en cuanto
   * el usuario tuviera dos reglas anidadas.
   */
  async rules(): Promise<EstablishmentRule[]> {
    const snap = await paths.rules(this.db, this.uid).get();
    return snap.docs
      .map((d) => {
        const data = d.data() as { pattern?: string; category: Category };
        // El id del documento es el patrón codificado; el campo `pattern` es la
        // fuente de verdad. Se cae al id sólo por si un documento viejo no lo
        // trae.
        return { pattern: data.pattern ?? d.id, category: data.category };
      })
      .sort((a, b) => b.pattern.length - a.pattern.length || a.pattern.localeCompare(b.pattern));
  }

  /** Los patrones silenciados como conjunto: una lectura por corrida, no una
   * por fila. */
  async silencedPatterns(): Promise<Set<string>> {
    const snap = await paths.silenced(this.db, this.uid).get();
    return new Set(snap.docs.map((d) => (d.data() as { pattern?: string }).pattern ?? d.id));
  }

  /** Todo lo silenciado, lo más reciente primero. */
  async listSilenced(): Promise<SilencedCounterparty[]> {
    const snap = await paths.silenced(this.db, this.uid).get();
    return snap.docs
      .map((d) => {
        const data = d.data() as { pattern?: string; counterparty: string; createdAt: string };
        return {
          pattern: data.pattern ?? d.id,
          counterparty: data.counterparty,
          created_at: data.createdAt,
        };
      })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.pattern.localeCompare(b.pattern)));
  }

  /**
   * **Todos** los movimientos contables del tenant.
   *
   * Es la lectura de la que salen los cinco indicadores de estrategia (ver el
   * doc de `strategy.ts`): el balance desde el snapshot y el promedio de gasto
   * esencial barren el ledger entero en el motor, así que traerlos por separado
   * costaría más y daría lo mismo. Sobre el ledger real son ~900 documentos.
   */
  async countableRows(): Promise<LedgerRow[]> {
    const snap = await paths
      .transactions(this.db, this.uid)
      .where("countable", "==", true)
      .select(...CAMPOS_DE_FILA)
      .get();
    return docsALedgerRows(snap.docs);
  }

  /**
   * La población de la cola de clasificación: gasto contable con contraparte.
   *
   * Es exactamente `selectClassifiableRows` del motor (`direction = 'out'`,
   * contraparte no vacía, más las exclusiones de todo total). Se deriva de
   * `countableRows` en memoria en vez de hacer su propia consulta porque
   * `classifyProgress` necesita las dos poblaciones —ésta para el denominador y
   * las de la cola para el numerador— y son una sola lectura.
   */
  static clasificables(contables: readonly LedgerRow[]): LedgerRow[] {
    return contables.filter(
      (row) => row.direction === "out" && toRulePattern(row.counterparty ?? "") !== ""
    );
  }

  /**
   * Sólo las filas que la cola PUEDE llegar a preguntar (`queueEligible`).
   *
   * Es un subconjunto estricto de `clasificables` —las que caen en un fallback
   * de `categorize()` sin mirar reglas— y por eso alcanza para dibujar la cola:
   * agregar una regla sólo puede sacar filas de un fallback, nunca meterlas.
   * Lo verifica `queue-parity.test.ts`. Sobre el ledger real son ~334
   * documentos contra ~900.
   */
  async queueEligibleRows(): Promise<LedgerRow[]> {
    const snap = await paths
      .transactions(this.db, this.uid)
      .where("queueEligible", "==", true)
      .select(...CAMPOS_DE_FILA)
      .get();
    return docsALedgerRows(snap.docs);
  }

  /** Los movimientos de un lote concreto (`?transaction_ids=`), por su id de
   * documento. Se piden de a 300 con `getAll`, que es una lectura facturada por
   * documento pero un solo viaje. */
  async docsByIds(ids: readonly string[]): Promise<TransactionDoc[]> {
    const unicos = [...new Set(ids)].filter((id) => id !== "");
    const out: TransactionDoc[] = [];
    for (let i = 0; i < unicos.length; i += 300) {
      const refs = unicos.slice(i, i + 300).map((id) => paths.transactions(this.db, this.uid).doc(id));
      const snaps = await this.db.getAll(...refs);
      for (const snap of snaps) {
        if (snap.exists) out.push(snap.data() as TransactionDoc);
      }
    }
    return out;
  }

  /** El último extracto de tarjeta cargado, o `null`. */
  async latestStatement(): Promise<StatementDoc | null> {
    const col = paths.statements(this.db, this.uid);
    const withDate = await col.orderBy("issueDate", "desc").limit(1).get();
    if (!withDate.empty) return withDate.docs[0]!.data() as StatementDoc;
    const any = await col.limit(1).get();
    return any.empty ? null : (any.docs[0]!.data() as StatementDoc);
  }

  /** Lo reservado en el colchón, o 0 si el usuario todavía no reservó nada. */
  async colchonReservado(): Promise<number> {
    const snap = await paths.savings(this.db, this.uid).doc("colchon").get();
    if (!snap.exists) return 0;
    const data = snap.data() as { reservedCents?: number };
    return fromCents(data.reservedCents ?? 0);
  }

  /** Fija lo reservado en el colchón. En centavos, como todo lo que se guarda. */
  async setColchonReservado(reserved: number, now: Date): Promise<number> {
    await paths.savings(this.db, this.uid).doc("colchon").set(
      { label: "colchon", reservedCents: toCents(reserved), updatedAt: now.toISOString() },
      { merge: true }
    );
    return fromCents(toCents(reserved));
  }

  /**
   * Los días del mes en los que cayó un sueldo, de todo el ledger. Los usa
   * `paydaysAfter` para refinar la ventana configurada contra lo que de verdad
   * pasó.
   */
  async diasDeSueldo(offsetHours: number): Promise<number[]> {
    const snap = await paths
      .transactions(this.db, this.uid)
      .where("type", "==", "sueldo")
      .select("ts", "day")
      .get();
    const dias: number[] = [];
    for (const doc of snap.docs) {
      const data = doc.data() as { ts?: string; day?: string | null };
      // `day` ya viene bucketeado con el huso del tenant; el `ts` es el respaldo
      // para un documento viejo que no lo tenga.
      const key = data.day ?? (data.ts ? localDayKey(data.ts, offsetHours) : null);
      if (key === null) continue;
      dias.push(Number(key.slice(8, 10)));
    }
    return dias;
  }

  /**
   * El primer y último `ts` de gasto, para `mesesDeHistorial`.
   *
   * El conjunto es el del motor y no el de un total: `direction='out'` con
   * `isReversed`, `isInternal` y `needsReview` en false — **sin** `isDiscarded`
   * y **sin** excluir `type='reverso'`. Se copia tal cual; "arreglarlo" acá
   * haría que las dos implementaciones den distinto.
   */
  async spanDeGasto(): Promise<{ primero: string | null; ultimo: string | null }> {
    const base = paths
      .transactions(this.db, this.uid)
      .where("direction", "==", "out")
      .where("isReversed", "==", false)
      .where("isInternal", "==", false)
      .where("needsReview", "==", false);
    const [asc, desc] = await Promise.all([
      base.orderBy("ts", "asc").limit(1).select("ts").get(),
      base.orderBy("ts", "desc").limit(1).select("ts").get(),
    ]);
    return {
      primero: asc.empty ? null : ((asc.docs[0]!.data() as { ts: string }).ts ?? null),
      ultimo: desc.empty ? null : ((desc.docs[0]!.data() as { ts: string }).ts ?? null),
    };
  }

  /** La cola de revisión: monto sin afirmar, lo más reciente primero. */
  async reviewDocs(): Promise<TransactionDoc[]> {
    const snap = await paths
      .transactions(this.db, this.uid)
      .where("needsReview", "==", true)
      .orderBy("ts", "desc")
      .get();
    return snap.docs.map((d) => d.data() as TransactionDoc);
  }

  async transactionDoc(id: string): Promise<TransactionDoc | null> {
    if (id === "") return null;
    const snap = await paths.transactions(this.db, this.uid).doc(id).get();
    return snap.exists ? (snap.data() as TransactionDoc) : null;
  }

  /**
   * El listado de movimientos, con los mismos filtros por defecto que
   * `queryTransactions`: sin reversos (ni la fila del consumo ni la de
   * auditoría), sin internas, sin descartadas — pero **con** las que esperan
   * revisión, que el listado sí muestra.
   *
   * Ese conjunto es exactamente la unión de dos consultas disjuntas:
   * `countable == true` (las cinco exclusiones ya materializadas) y
   * `needsReview == true` menos las que además son reverso/interna/descartada.
   * Se resuelve así y no con una consulta sola porque Firestore no sabe
   * expresar `type != 'reverso'` junto a otras igualdades sin arrastrar el
   * orden. El segundo conjunto es la cola de revisión, que es chica.
   *
   * La paginación es por `offset`, igual que el motor: se leen `offset + limit`
   * documentos del primer conjunto. Es el mismo costo que un `LIMIT/OFFSET` de
   * SQL, que también recorre lo salteado.
   */
  async listTransactions(filter: TransactionsFilter): Promise<TransactionDoc[]> {
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const conFiltros = (q: Query<DocumentData>): Query<DocumentData> => {
      let out = q;
      if (filter.type) out = out.where("type", "==", filter.type);
      if (filter.direction) out = out.where("direction", "==", filter.direction);
      if (filter.counterparty) out = out.where("counterparty", "==", filter.counterparty);
      if (filter.from) out = out.where("ts", ">=", filter.from);
      if (filter.to) out = out.where("ts", "<=", filter.to);
      return out;
    };

    const col = paths.transactions(this.db, this.uid);
    const [contables, enRevision] = await Promise.all([
      conFiltros(col.where("countable", "==", true)).orderBy("ts", "desc").limit(offset + limit).get(),
      conFiltros(col.where("needsReview", "==", true)).orderBy("ts", "desc").get(),
    ]);

    const filas = [
      ...contables.docs.map((d) => d.data() as TransactionDoc),
      ...enRevision.docs
        .map((d) => d.data() as TransactionDoc)
        // Una fila en revisión que además es reverso, interna o descartada no
        // entra: son las mismas exclusiones del listado, aplicadas al conjunto
        // que `countable` no cubre.
        .filter((doc) => !doc.isReversed && !doc.isInternal && !doc.isDiscarded && doc.type !== "reverso"),
    ];

    // Más recientes primero, con el id como desempate para que dos corridas
    // sobre el mismo ledger devuelvan el mismo orden.
    filas.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : a.gmailMsgId.localeCompare(b.gmailMsgId)));
    return filas.slice(offset, offset + limit);
  }

  /**
   * La contraparte REAL del ledger que corresponde al texto recibido, o `null`.
   *
   * Es **igualdad sobre el patrón normalizado**, no subcadena, y a propósito:
   * aceptar un fragmento convertiría a `POST /classify` en el editor de reglas
   * que el MVP elimina, con su trampa intacta —un patrón más largo que la
   * contraparte no matchea nunca— pero disfrazada. Devuelve la grafía cruda del
   * movimiento más reciente, que es la que el usuario acaba de ver.
   */
  async resolveCounterparty(raw: string): Promise<string | null> {
    const wanted = toRulePattern(raw);
    if (wanted === "") return null;
    const snap = await paths
      .transactions(this.db, this.uid)
      .where("pattern", "==", wanted)
      .orderBy("ts", "desc")
      .limit(1)
      .select("counterparty")
      .get();
    if (snap.empty) return null;
    const counterparty = (snap.docs[0]!.data() as { counterparty: string | null }).counterparty;
    return counterparty === null ? null : counterparty.trim();
  }

  /**
   * Los documentos cuya contraparte normalizada **contiene** el patrón — las
   * que una regla con ese patrón podría mover.
   *
   * Firestore no tiene subcadena, así que se lee la colección y se filtra en
   * memoria. Es la consulta más cara del backend (sobre el ledger real, ~1200
   * documentos) y está acotada a un acto del usuario que ocurre unas ciento
   * cincuenta veces en la vida de una billetera: responder "qué es esto". La
   * alternativa —materializar un campo por cada prefijo posible— sería inventar
   * una segunda definición de cómo matchea una regla.
   */
  async docsQueContienenPatron(pattern: string): Promise<TransactionDoc[]> {
    if (pattern === "") return [];
    const snap = await paths.transactions(this.db, this.uid).get();
    return snap.docs
      .map((d) => d.data() as TransactionDoc)
      .filter((doc) => doc.counterparty !== null && toRulePattern(doc.counterparty).includes(pattern));
  }

  /**
   * Escribe UNA regla, con el patrón ya derivado de la contraparte real.
   *
   * El id del documento es el patrón codificado: una regla por patrón, que es
   * exactamente el `UNIQUE(pattern)` que tenía la tabla. `createdAt` se
   * preserva si ya existía —responder de nuevo por el mismo comercio cambia la
   * categoría, no la antigüedad de la regla.
   */
  async upsertRule(counterparty: string, pattern: string, category: Category, now: Date): Promise<void> {
    const ref = paths.rules(this.db, this.uid).doc(paths.encodeDocId(pattern));
    const previo = await ref.get();
    await ref.set(
      {
        pattern,
        counterparty,
        category,
        createdAt: (previo.data() as { createdAt?: string } | undefined)?.createdAt ?? now.toISOString(),
      },
      { merge: true }
    );
  }

  /**
   * Escribe la columna `storedCategory` de los documentos que una regla movió.
   *
   * No hace falta para los totales —el motor recalcula en vivo— pero deja el
   * ledger consistente con lo que el gráfico muestra. Lo que NO toca, nunca: el
   * monto, la dirección, el tipo ni `needsReview`. Esta capa mueve etiquetas;
   * la plata sale del parser (CLAUDE.md, regla 1).
   */
  async actualizarCategorias(cambios: readonly { id: string; category: Category }[]): Promise<void> {
    // 400 deja aire bajo el tope de 500 operaciones por batch.
    for (let i = 0; i < cambios.length; i += 400) {
      const batch = this.db.batch();
      for (const cambio of cambios.slice(i, i + 400)) {
        batch.update(paths.transactions(this.db, this.uid).doc(cambio.id), {
          storedCategory: cambio.category,
        });
      }
      await batch.commit();
    }
  }

  /** Saca una contraparte de la cola. Devuelve si de verdad cambió algo:
   * silenciar lo ya silenciado no saca un solo movimiento (R13). */
  async silenciar(pattern: string, counterparty: string, now: Date): Promise<boolean> {
    const ref = paths.silenced(this.db, this.uid).doc(paths.encodeDocId(pattern));
    const previo = await ref.get();
    // La grafía cruda se refresca igual —la del ledger es la que el usuario
    // acaba de ver— pero `createdAt` es de la PRIMERA vez: es lo que ordena la
    // lista de silenciados, y pisarlo la reordenaría en cada re-silenciado.
    await ref.set(
      {
        pattern,
        counterparty,
        createdAt: (previo.data() as { createdAt?: string } | undefined)?.createdAt ?? now.toISOString(),
      },
      { merge: true }
    );
    return !previo.exists;
  }

  /** Devuelve a la cola algo silenciado por error. `false` si no había nada. */
  async desilenciar(pattern: string): Promise<boolean> {
    if (pattern === "") return false;
    const ref = paths.silenced(this.db, this.uid).doc(paths.encodeDocId(pattern));
    if (!(await ref.get()).exists) return false;
    await ref.delete();
    return true;
  }

  /**
   * Escribe una fila resuelta y su rastro de auditoría **en una transacción**.
   *
   * Que vayan juntas no es prolijidad: un movimiento que reaparece en los
   * totales sin rastro es indistinguible de un bug del motor, y el rastro es lo
   * que hace usable la salida de la cola.
   */
  async aplicarResolucion(
    doc: TransactionDoc,
    resolution: Omit<ReviewResolutionDoc, "id">
  ): Promise<{ doc: TransactionDoc; resolution: ReviewResolutionDoc }> {
    const txRef = paths.transactions(this.db, this.uid).doc(doc.gmailMsgId);
    const resRef = paths.reviews(this.db, this.uid).doc();
    const actualizado = recomputarDerivados(doc);

    await this.db.runTransaction(async (t) => {
      t.set(txRef, actualizado as unknown as Record<string, unknown>);
      t.set(resRef, {
        gmailMsgId: resolution.gmail_msg_id,
        action: resolution.action,
        previousAmountCents: resolution.previous_amount === null ? null : toCents(resolution.previous_amount),
        newAmountCents: resolution.new_amount === null ? null : toCents(resolution.new_amount),
        note: resolution.note,
        resolvedBy: resolution.resolved_by,
        resolvedAt: resolution.resolved_at,
      });
    });

    return { doc: actualizado, resolution: { ...resolution, id: resRef.id } };
  }

  /** El historial de resoluciones, más recientes primero. */
  async listResoluciones(limit = 200): Promise<ReviewResolutionDoc[]> {
    const snap = await paths
      .reviews(this.db, this.uid)
      .orderBy("resolvedAt", "desc")
      .limit(limit)
      .get();
    return snap.docs.map((d) => {
      const data = d.data() as {
        gmailMsgId: string;
        action: string;
        previousAmountCents: number | null;
        newAmountCents: number | null;
        note: string | null;
        resolvedBy: string;
        resolvedAt: string;
      };
      return {
        id: d.id,
        transaction_id: data.gmailMsgId,
        gmail_msg_id: data.gmailMsgId,
        action: data.action,
        previous_amount: data.previousAmountCents === null ? null : fromCents(data.previousAmountCents),
        new_amount: data.newAmountCents === null ? null : fromCents(data.newAmountCents),
        note: data.note ?? null,
        resolved_by: data.resolvedBy,
        resolved_at: data.resolvedAt,
      };
    });
  }

  // --- el estado del sync ---------------------------------------------------

  async syncState(): Promise<SyncStateDoc> {
    const snap = await paths.configDoc(this.db, this.uid, "sync").get();
    const data = snap.exists ? (snap.data() as Record<string, unknown>) : {};
    const backlog = data.backlog as SyncStateDoc["backlog"] | undefined;
    return {
      lastSyncTs: typeof data.lastSyncTs === "string" && data.lastSyncTs !== "" ? data.lastSyncTs : null,
      runningSince: typeof data.runningSince === "string" && data.runningSince !== "" ? data.runningSince : null,
      backlog: backlog ?? null,
    };
  }

  async escribirSyncState(patch: Record<string, unknown>): Promise<void> {
    await paths.configDoc(this.db, this.uid, "sync").set(patch, { merge: true });
  }

  /**
   * La guarda de `POST /api/sync`, **en Firestore y no en memoria**.
   *
   * El motor la resuelve con un `let running` del proceso, y eso era correcto
   * mientras un proceso servía a una persona. Acá hay hasta cinco instancias de
   * la función de ingesta: un booleano de proceso no vería el lote que está
   * corriendo en otra, y las dos leerían el mismo buzón a la vez.
   *
   * La toma es una transacción —leer-y-escribir atómico— así que dos peticiones
   * simultáneas no pueden ganarla las dos. El vencimiento existe porque una
   * función que muere por timeout no llega a soltarla, y sin él la billetera
   * quedaría con "hay un sync corriendo" para siempre.
   */
  async tomarGuardaDeSync(now: Date, vencimientoMs: number): Promise<boolean> {
    const ref = paths.configDoc(this.db, this.uid, "sync");
    return this.db.runTransaction(async (t) => {
      const snap = await t.get(ref);
      const desde = snap.exists ? (snap.data() as { runningSince?: unknown }).runningSince : undefined;
      if (typeof desde === "string" && desde !== "") {
        const arrancó = new Date(desde).getTime();
        if (Number.isFinite(arrancó) && now.getTime() - arrancó < vencimientoMs) return false;
      }
      t.set(ref, { runningSince: now.toISOString() }, { merge: true });
      return true;
    });
  }

  async soltarGuardaDeSync(): Promise<void> {
    await paths.configDoc(this.db, this.uid, "sync").set({ runningSince: null }, { merge: true });
  }
}

/** Recalcula la categoría de una fila con un juego de reglas dado. Vive acá
 * para que los escritores no tengan que rearmar el objeto de entrada. */
export function recategorizar(doc: TransactionDoc, rules: readonly EstablishmentRule[]): Category {
  return categorize(
    { type: doc.type, counterparty: doc.counterparty, is_internal: doc.isInternal },
    rules
  );
}
