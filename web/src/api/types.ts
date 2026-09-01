/**
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
