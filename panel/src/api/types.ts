/**
 * **Copia de `web/src/api/types.ts`** (criterio 4 de TASK-056: copiar es
 * copiar). Lo copiado queda tal cual, con su comentario original; lo que N2
 * necesita y no existía se agrega al final, en su propio bloque.
 *
 * Original:
 *
 * Types mirroring the F1-09 read-only API's real response shapes, as read
 * from server/src/api/{routes,queries,schemas}.ts and server/src/db/repository.ts.
 * Kept hand-written (not imported from server/) because this ticket's file
 * boundary is web/ only — server/ is owned by other tickets.
 */

export interface TransactionRow {
  id: number;
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
  source: string;
  created_at: string;
}

export interface TransactionsResponse {
  transactions: TransactionRow[];
  count: number;
}

export interface TransactionsFilter {
  from?: string;
  to?: string;
  type?: string;
  direction?: string;
  counterparty?: string;
  limit?: number;
  offset?: number;
}

export interface CardOverview {
  card_mask: string | null;
  issue_date: string | null;
  balance: number | null;
  min_payment: number | null;
  due_date: string | null;
}

export interface BalanceSnapshot {
  amount: number;
  currency: string;
  at: string | null;
}

export interface OverviewCounts {
  total: number;
  needs_review: number;
}

/**
 * F2-D strategy indicator shapes, mirrored (as read from
 * server/src/strategy/{balance,card,transfers,spending}.ts and
 * server/src/category/categorize.ts) rather than imported, per this
 * ticket's web/-only file boundary.
 */
export interface ColchonStatus {
  objetivo: number;
  reservado: number;
  financiado: boolean;
  faltante: number;
}

export interface CardStatus {
  saldoCorte: number;
  minimo: number;
  fechaMaxima: string | null;
  saldoActualEstimado: number;
  aTiempo: boolean;
  requeridoPorQuincena: number;
}

export interface CounterpartyTotal {
  counterparty: string;
  total: number;
}

export interface TransfersSummary {
  total: number;
  tope: number;
  restante: number;
  sobrepasado: boolean;
  topContrapartes: CounterpartyTotal[];
}

/** The glossary's fixed category set (server/src/category/categorize.ts Category). */
export type Category =
  | "comida"
  | "transporte"
  | "salud"
  | "mascota"
  | "servicios"
  | "recarga"
  | "efectivo"
  | "transferencia_persona"
  | "suscripcion"
  | "otros";

/** spending_by_category: only categories with at least one matching row appear. */
export type SpendingByCategory = Partial<Record<Category, number>>;

export interface OverviewResponse {
  balance: BalanceSnapshot | null;
  card: CardOverview | null;
  counts: OverviewCounts;
  safe_to_spend_hoy: number;
  buffer_status: ColchonStatus;
  card_status: CardStatus | null;
  transfers_summary: TransfersSummary;
  next_payday: string | null;
  spending_by_category: SpendingByCategory;
}

/**
 * Progreso del backlog del sync. Una llamada a /api/sync drena UN LOTE: el
 * primer sync de un buzon con anios de historial son miles de correos, cada
 * uno pasa por Claude, y no entra en una sola request (ver
 * server/src/sync/run-sync.ts). Con `complete:false` hay que volver a pulsar.
 */
export interface SyncProgress {
  processed: number;
  total: number;
  remaining: number;
  complete: boolean;
}

/**
 * El resto del cuerpo de /api/sync sigue siendo un record abierto a
 * proposito: la UI muestra las claves que vengan sin inventar ninguna. Lo
 * unico que si tiene contrato es `progress`, porque de ahi sale si el sync
 * termino o falta seguir llamando.
 */
export type SyncResponse = Record<string, unknown> & { progress?: SyncProgress };

/**
 * GET /api/sync/status (server/src/api/routes.ts). `last_sync_ts` en null es
 * "nunca se sincronizo", no "hoy"; `backlog` en null es "no quedo nada a
 * medias", no "cero correos pendientes".
 */
export interface SyncStatusResponse {
  last_sync_ts: string | null;
  backlog: { processed: number; total: number; remaining: number; updated_at: string } | null;
  /**
   * N2 (R9): si hay un `POST /api/sync` en vuelo AHORA. Es opcional en el tipo
   * a proposito — un server anterior a N2 no lo manda, y ausente significa
   * "no se", que el panel dibuja como "no hay ninguno corriendo" y no como un
   * `false` afirmado por el server.
   *
   * No es lo mismo que `backlog !== null`: quedar a medias es el estado normal
   * ENTRE dos llamadas.
   */
  running?: boolean;
}

/**
 * F3-C chat shapes, mirrored (as read from
 * server/src/chat/conversation-repository.ts and server/src/api/chat-route.ts)
 * rather than imported, per this ticket's web/-only file boundary.
 */
export interface ConversationSummary {
  id: string;
  created_at: string;
  updated_at: string;
  last_message: string | null;
}

export interface ChatMessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  ts: string;
}

export interface ConversationsResponse {
  conversations: ConversationSummary[];
}

export interface ConversationDetailResponse {
  conversation: { id: string; created_at: string; updated_at: string };
  messages: ChatMessageRow[];
}

/* ==========================================================================
 * Lo que N2 agrega a la copia (nada de arriba se modificó salvo `running`,
 * que es un campo nuevo de una respuesta existente).
 * ========================================================================== */

/**
 * La respuesta de `POST /api/sync`, con los dos campos que el motor repite
 * fuera del resumen. `inserted_ids` son las filas que entraron en ESTE lote:
 * es lo que hace que el aviso post-sync de categoría lleve a la cola acotada
 * al lote (D7-b) y no a la cola entera.
 */
export type SyncTriggerResponse = SyncResponse & { inserted_ids?: number[] };

/** `GET /api/classify/progress` — `server/src/classify/progress.ts`. */
export interface ClassifyProgressResponse {
  spending_total: number;
  baseline_total: number;
  covered_total: number;
  covered_ratio: number;
  unclassified_total: number;
  /** Sobre `spending_total` — **no** es el complemento de `covered_ratio`. Ver
   * `remaining_ratio` (wargaming ronda 3, W19). */
  unclassified_ratio: number;
  /** Sobre `baseline_total`: el complemento exacto de `covered_ratio`, y el
   * único que se puede dibujar junto a la barra. */
  remaining_ratio: number;
  /** Contrapartes que quedan por responder — los "K comercios" del Resumen. */
  groups: number;
  /** Movimientos que representan esas contrapartes — los "M sin clasificar". */
  transactions: number;
  target_ratio: number;
  answers_to_target: number;
  amount_to_target: number;
  done: boolean;
}

/** Un grupo de la cola: una contraparte, no una fila (H32). Espejo de
 * `ClassifyGroup` en `server/src/classify/queue.ts`. */
export interface ClassifyGroupRow {
  pattern: string;
  counterparty: string;
  count: number;
  total: number;
  months: number;
  category: Category;
  last_ts: string;
  /** Sólo en modo lote (`?transaction_ids=`): cuántos movimientos y cuánta
   * plata tiene esta contraparte en TODO el ledger. La regla que se escriba los
   * mueve a todos, y la tarjeta lo tiene que decir (W23). */
  count_en_ledger?: number;
  total_en_ledger?: number;
}

export interface ClassifyQueueResponse {
  groups: ClassifyGroupRow[];
  count: number;
}

/* ==========================================================================
 * Lo que N3 agrega: las tres respuestas de escritura que la pantalla de
 * Preguntas necesita leer con contrato, porque de sus campos sale lo que la
 * pantalla dice que pasó (F13/R19). No alcanza con "salió bien".
 * ========================================================================== */

/**
 * `POST /api/classify` — `server/src/classify/apply.ts`.
 *
 * Los dos conteos son el motivo por el que este tipo existe:
 * `reclassified` es cuántos movimientos movió la regla y
 * `reclassified_this_month` cuántos de ellos caen en el mes que el gráfico del
 * Resumen dibuja. Con el segundo en cero la respuesta fue correcta y el gráfico
 * no se mueve, y la pantalla tiene que poder decirlo (R19).
 */
export interface ClassifyApplyResponse {
  ok: true;
  pattern: string;
  counterparty: string;
  category: Category;
  reclassified: number;
  reclassified_this_month: number;
  /**
   * Cuántas contrapartes ADEMÁS de la preguntada movió la regla (W12). Opcional
   * porque un server anterior a la ronda 2 no lo manda, y ausente se lee como
   * cero: no se inventa un alcance que el motor no declaró.
   */
  otras_contrapartes?: number;
}

/** El rastro que `POST /api/review/:id/resolve` deja al resolver
 * (`server/src/review/resolve.ts`). */
export interface ReviewResolutionRow {
  id: number;
  transaction_id: number;
  gmail_msg_id: string;
  action: ReviewAction;
  previous_amount: number | null;
  new_amount: number | null;
  note: string | null;
  resolved_by: string;
  resolved_at: string;
}

export type ReviewAction = "confirm" | "correct" | "discard";

/**
 * `POST /api/review/:id/resolve`.
 *
 * **`changed` es parte del contrato, no un detalle** (R13): el motor devuelve
 * `{ok:true, changed:false}` con status 200 cuando la fila ya estaba resuelta,
 * y eso NO es éxito — es "esto ya lo resolviste en otro lado". Una pantalla que
 * mire sólo `ok` festeja una acción que no ocurrió.
 */
export type ReviewResolveResponse =
  | { ok: true; changed: true; action: ReviewAction; transaction: TransactionRow; resolution: ReviewResolutionRow }
  | { ok: true; changed: false; reason: "already_resolved"; transaction: TransactionRow };

/* ==========================================================================
 * Lo que N4 agrega: el perfil mínimo (H2) y la lectura de gastos fijos (H30).
 * ========================================================================== */

/**
 * `GET/POST /api/onboarding/profile` — `server/src/api/onboarding-route.ts`.
 *
 * **`colchon_fijado` no es derivable de `colchon_objetivo` sin repetir la regla
 * en el cliente** (R25): un objetivo en cero es un objetivo que nadie fijó, no
 * uno cumplido, y quien decide eso es el motor. `dia_de_pago_fijado` es lo
 * mismo del otro lado: sin día de pago no hay safe-to-spend (R7), y una lista
 * vacía es "todavía no", no "ninguno".
 */
export interface ProfileResponse {
  dias_pago: string[];
  dia_de_pago_fijado: boolean;
  colchon_objetivo: number;
  colchon_fijado: boolean;
}

/** La respuesta de `POST`: el perfil ya guardado más qué campos se escribieron. */
export type ProfileWriteResponse = ProfileResponse & { ok: true; campos: string[] };

/**
 * Una propuesta de gasto fijo (H30). Espejo de `RecurringExpenseProposal` en
 * `server/src/onboard/recurring.ts`.
 *
 * `monto_estimado` es la **mediana** de los totales mensuales y `sample_size`
 * en cuántos meses se apoya. Los dos se dibujan juntos siempre: una mediana sin
 * su muestra promete más de lo que hay (riesgo 3 del plan).
 */
export interface RecurringProposalRow {
  pattern: string;
  counterparty: string;
  monto_estimado: number;
  /** `null` cuando los días observados no sostienen un día típico. */
  dia_tipico: number | null;
  sample_size: number;
  count: number;
  total: number;
  last_ts: string;
}

/**
 * `GET /api/onboarding/recurring`.
 *
 * `en_la_cola` son las candidatas que no entraron al top 10 (H34) y siguen
 * esperando en la cola de clasificación — no se perdieron. `suficiente_historial`
 * es el freno de R33: con menos de `meses_minimos` el análisis no se dibuja
 * activo y la pantalla dice cuánto lleva acumulado.
 */
export interface RecurringResponse {
  propuestas: RecurringProposalRow[];
  candidatas: number;
  en_la_cola: number;
  meses_de_historial: number;
  meses_minimos: number;
  suficiente_historial: boolean;
}

/* ==========================================================================
 * Lo que N5 agrega: los dos campos que `GET /api/transactions` devuelve **sólo**
 * cuando se le pide una categoría recalculada.
 * ========================================================================== */

/**
 * La lista de una barra del gráfico (H21) — `server/src/classify/movements.ts`.
 *
 * `total` y `amount` son opcionales porque el motor sólo los manda en ese caso,
 * y eso **no** es una omisión que haya que arreglar: sin categoría no hay total
 * y no se pide (H20, *cargar más*). Un `total` en el listado general sería un
 * `COUNT` en cada tecleo de filtro para dibujar un número que nadie mira.
 *
 * `total` es, literalmente, **el número que contó la barra**: `amount` es su
 * plata. De ahí sale que la lista y el gráfico no puedan discrepar.
 */
export interface TransactionsListResponse extends TransactionsResponse {
  total?: number;
  amount?: number;
}

/**
 * `TransactionsFilter` más `category`. Es un tipo nuevo y no un campo agregado
 * al de arriba por la misma razón que el resto de este archivo: lo copiado de
 * `web/` queda como está, y lo que el panel necesita de más vive en su bloque.
 */
export interface TransactionsQuery extends TransactionsFilter {
  /** La categoría **recalculada** de una barra del gráfico (H21). No es un
   * `WHERE category = ?`: el motor rehace el cálculo con `categorize()` + las
   * reglas del usuario, que es lo único que hace que la lista tenga las filas
   * que la barra contó. Cuando viene, el resto de los filtros no aplica. */
  category?: Category;
}
