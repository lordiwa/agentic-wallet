/**
 * Typed client for the F1-09 read-only API (/api/transactions, /api/review,
 * /api/overview) plus the F1-08 sync trigger (/api/sync). Calls are relative
 * ("/api/...") because the Express server serves the built SPA and the API
 * on the same local port (F1-01/F1-09 index.ts) — no base URL to configure.
 *
 * Observability note: this repo has no OpenTelemetry setup anywhere (server
 * or web) and ships no .claude/shared/OBSERVABILITY.md, so pulling in a
 * browser OTel SDK here would be an unsanctioned dependency for a
 * local-only, single-user dashboard. Each call instead emits a structured
 * console log (operation name, outcome, duration) as a proportionate stand-in.
 */
import { apiFetch } from "./base";
import type {
  ConversationDetailResponse,
  ConversationsResponse,
  OverviewResponse,
  SyncResponse,
  SyncStatusResponse,
  TransactionsFilter,
  TransactionsResponse,
} from "./types";

function logOutcome(op: string, startedAt: number, outcome: "ok" | "error", extra?: Record<string, unknown>) {
  const entry = { op, outcome, duration_ms: Math.round(performance.now() - startedAt), ...extra };
  if (outcome === "error") {
    console.error("[api]", entry);
  } else {
    console.info("[api]", entry);
  }
}

async function getJSON<T>(op: string, path: string): Promise<T> {
  const startedAt = performance.now();
  try {
    const res = await apiFetch(path);
    if (!res.ok) {
      throw new Error(`${op} failed: ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as T;
    logOutcome(op, startedAt, "ok");
    return body;
  } catch (err) {
    logOutcome(op, startedAt, "error", { message: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export function fetchTransactions(filter: TransactionsFilter = {}): Promise<TransactionsResponse> {
  const params = new URLSearchParams();
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);
  if (filter.type) params.set("type", filter.type);
  if (filter.direction) params.set("direction", filter.direction);
  if (filter.counterparty) params.set("counterparty", filter.counterparty);
  if (filter.limit != null) params.set("limit", String(filter.limit));
  if (filter.offset != null) params.set("offset", String(filter.offset));
  const qs = params.toString();
  return getJSON<TransactionsResponse>("transactions.list", `/api/transactions${qs ? `?${qs}` : ""}`);
}

export function fetchReview(): Promise<TransactionsResponse> {
  return getJSON<TransactionsResponse>("review.list", "/api/review");
}

export function fetchOverview(): Promise<OverviewResponse> {
  return getJSON<OverviewResponse>("overview.get", "/api/overview");
}

/** Estado del sync EN FRIO (cuando fue el ultimo, que quedo a medias) — a
 * diferencia de `postSync`, no dispara nada: se puede pedir en cada refresco
 * sin tocar Gmail ni gastar credito de Claude. */
export function fetchSyncStatus(): Promise<SyncStatusResponse> {
  return getJSON<SyncStatusResponse>("sync.status", "/api/sync/status");
}

/** Sonda de conectividad para el cartel de conexion: no lanza, responde si
 * el backend configurado contesta. */
export async function pingBackend(): Promise<boolean> {
  try {
    const res = await apiFetch("/api/health");
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Triggers a sync (F1-08, not yet built as of this ticket). The response
 * shape isn't known yet, so this returns whatever JSON body comes back
 * without assuming fields, and surfaces a readable error (including a 404
 * for the not-yet-mounted endpoint) rather than crashing the UI.
 */
export async function postSync(): Promise<SyncResponse> {
  const op = "sync.trigger";
  const startedAt = performance.now();
  try {
    const res = await apiFetch("/api/sync", { method: "POST" });
    const body = (await res.json().catch(() => null)) as (SyncResponse & { error?: string }) | null;
    if (!res.ok) {
      const message = body?.error ?? `Sync failed: ${res.status} ${res.statusText}`;
      throw new Error(message);
    }
    logOutcome(op, startedAt, "ok");
    return body ?? {};
  } catch (err) {
    logOutcome(op, startedAt, "error", { message: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

export function fetchConversations(): Promise<ConversationsResponse> {
  return getJSON<ConversationsResponse>("chat.conversations.list", "/api/conversations");
}

export function fetchConversation(id: string): Promise<ConversationDetailResponse> {
  return getJSON<ConversationDetailResponse>("chat.conversations.get", `/api/conversations/${id}`);
}

/**
 * F3-D: consumes POST /api/chat/:conversationId?'s text/event-stream (see
 * server/src/api/chat-route.ts's header comment for the authoritative event
 * contract). This is a POST endpoint, so the browser's `EventSource` (GET-only)
 * cannot be used -- instead this reads the fetch Response body with a
 * `ReadableStream` reader and parses the `event:`/`data:` SSE framing by
 * hand, splitting on the blank-line frame separator, matching the rest of
 * this file's hand-rolled/no-new-dependency approach.
 */
export interface ChatStreamHandlers {
  onMeta?: (conversationId: string) => void;
  onText?: (text: string) => void;
  onTool?: (name: string, status: string) => void;
  onDone?: (assistantText: string) => void;
  onError?: (message: string) => void;
}

function dispatchSseFrame(frame: string, handlers: ChatStreamHandlers): void {
  let event = "message";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) data += line.slice("data:".length).trim();
  }
  if (!data) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return;
  }

  switch (event) {
    case "meta":
      handlers.onMeta?.((parsed as { conversationId: string }).conversationId);
      break;
    case "text":
      handlers.onText?.((parsed as { text: string }).text);
      break;
    case "tool": {
      const tool = parsed as { name: string; status: string };
      handlers.onTool?.(tool.name, tool.status);
      break;
    }
    case "done":
      handlers.onDone?.((parsed as { assistantText: string }).assistantText);
      break;
    case "error":
      handlers.onError?.((parsed as { message: string }).message);
      break;
    default:
      break;
  }
}

/**
 * Posts a chat message and streams the reply via `handlers`. Resolves once
 * the stream ends (on `done` or `error`) -- callers drive UI state from the
 * handler callbacks, not from this promise's return value. The no-credential
 * case (a plain 503 JSON body, sent before any SSE framing per chat-route.ts)
 * and any other pre-stream HTTP failure are reported through `onError` just
 * like a mid-stream `error` event, so callers only need one error path.
 */
export async function streamChat(
  message: string,
  conversationId: string | undefined,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const op = "chat.stream";
  const startedAt = performance.now();
  const path = conversationId ? `/api/chat/${conversationId}` : "/api/chat";

  let res: Response;
  try {
    res = await apiFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
      signal,
    });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    logOutcome(op, startedAt, "error", { message: errMessage });
    handlers.onError?.(errMessage);
    return;
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    const errMessage =
      body?.error === "claude_not_configured"
        ? "Claude no esta configurado (falta credencial)."
        : (body?.error ?? `Chat fallo: ${res.status} ${res.statusText}`);
    logOutcome(op, startedAt, "error", { message: errMessage });
    handlers.onError?.(errMessage);
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    const errMessage = "El navegador no soporta streaming de respuesta.";
    logOutcome(op, startedAt, "error", { message: errMessage });
    handlers.onError?.(errMessage);
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sepIndex = buffer.indexOf("\n\n");
      while (sepIndex !== -1) {
        const frame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        dispatchSseFrame(frame, handlers);
        sepIndex = buffer.indexOf("\n\n");
      }
    }
    logOutcome(op, startedAt, "ok");
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    logOutcome(op, startedAt, "error", { message: errMessage });
    handlers.onError?.(errMessage);
  }
}
