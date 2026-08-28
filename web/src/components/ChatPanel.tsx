import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { fetchConversation, fetchConversations, streamChat } from "../api/client";
import type { ConversationSummary } from "../api/types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * F3-D: chat panel consuming F3-C's POST /api/chat/:conversationId? SSE
 * stream (see api/client.ts's streamChat for the frame-parsing side) plus
 * GET /api/conversations[/:id] for history. Kept as one component, matching
 * TransactionsTable's precedent of a single file for one cohesive section
 * rather than splitting sub-parts that don't have independently reusable
 * rendering logic (contrast StrategySection/StrategyCards, which split
 * because cards vs. charts are genuinely separate render concerns).
 */
export function ChatPanel() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  function loadConversations() {
    fetchConversations()
      .then((res) => setConversations(res.conversations))
      .catch((err) => setHistoryError(err instanceof Error ? err.message : "Error al cargar el historial"));
  }

  // Abort any in-flight turn on unmount, mirroring the server's own
  // client-disconnect handling (chat-route.ts's AbortController-on-close).
  useEffect(() => {
    loadConversations();
    return () => abortRef.current?.abort();
  }, []);

  function resetTurnState() {
    setStreamingText("");
    setToolStatus(null);
    setError(null);
  }

  // Switching conversations while a turn streams would race the in-flight
  // response against a freshly-loaded history, so both this and "new
  // conversation" are disabled while streaming (buttons carry `disabled`).
  function handleSelectConversation(id: string) {
    setConversationId(id);
    setMessages([]);
    resetTurnState();
    fetchConversation(id)
      .then((res) => {
        setMessages(res.messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })));
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Error al cargar la conversacion"));
  }

  function handleNewConversation() {
    setConversationId(undefined);
    setMessages([]);
    resetTurnState();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || streaming) return;

    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setDraft("");
    resetTurnState();
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    await streamChat(
      text,
      conversationId,
      {
        // A POST without :conversationId starts a new conversation server-side;
        // `meta` is how the client learns its generated id (chat-route.ts).
        onMeta: (id) => setConversationId((prev) => prev ?? id),
        onText: (chunk) => {
          setToolStatus(null); // AC2: clear tool status once the answer resumes.
          setStreamingText((prev) => prev + chunk);
        },
        onTool: (_name, status) => setToolStatus(status),
        onDone: (assistantText) => {
          // Use the server's final assistantText rather than the accumulated
          // streamingText -- it's the canonical value chat-service.ts persisted.
          setMessages((prev) => [...prev, { role: "assistant", content: assistantText }]);
          setStreamingText("");
          setToolStatus(null);
          setStreaming(false);
          loadConversations(); // pick up the new/updated conversation's preview.
        },
        onError: (message) => {
          // A mid-stream error can arrive after some text chunks; keep the
          // partial answer visible as its own bubble rather than discarding it.
          setStreamingText((partial) => {
            if (partial) setMessages((prev) => [...prev, { role: "assistant", content: partial }]);
            return "";
          });
          setToolStatus(null);
          setStreaming(false);
          setError(message);
        },
      },
      controller.signal,
    );
  }

  return (
    <section aria-labelledby="chat-heading">
      <h2 id="chat-heading">Asistente</h2>

      <nav aria-label="Historial de conversaciones">
        <button type="button" onClick={handleNewConversation} disabled={streaming}>
          Nueva conversacion
        </button>
        {historyError && <p role="alert">{historyError}</p>}
        <ul>
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => handleSelectConversation(c.id)}
                aria-current={c.id === conversationId ? "true" : undefined}
                disabled={streaming}
              >
                {c.last_message ?? "Conversacion sin mensajes"}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div role="log" aria-label="Conversacion">
        {messages.length === 0 && !streamingText && <p>Escribe un mensaje para comenzar.</p>}
        {messages.map((m, i) => (
          <p key={i} className={m.role === "user" ? "chat-message chat-message--user" : "chat-message chat-message--assistant"}>
            <strong>{m.role === "user" ? "Tu" : "Asistente"}:</strong> {m.content}
          </p>
        ))}
        {streaming && streamingText && (
          <p className="chat-message chat-message--assistant">
            <strong>Asistente:</strong> {streamingText}
          </p>
        )}
        {toolStatus && (
          <p role="status" className="chat-tool-status">
            {toolStatus}
          </p>
        )}
      </div>

      {error && <p role="alert">{error}</p>}

      <form onSubmit={handleSubmit}>
        <label htmlFor="chat-input">Mensaje</label>
        <input id="chat-input" type="text" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={streaming} />
        <button type="submit" disabled={streaming || !draft.trim()}>
          Enviar
        </button>
      </form>
    </section>
  );
}
