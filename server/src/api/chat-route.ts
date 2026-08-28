/**
 * F3-C: POST /api/chat/:conversationId? (streaming SSE) plus GET
 * /api/conversations and GET /api/conversations/:id (history), all via F3-A
 * (server/src/chat/conversation-repository.ts). The turn itself is run by
 * chat-service.ts's `runChatTurn` -- this file only owns HTTP framing:
 * SSE headers/events, the no-credential gate, and aborting the in-flight
 * query on client disconnect.
 *
 * SSE EVENT CONTRACT (documented for F3-D / TASK-036 to consume). Every
 * event is standard SSE framing (`event: <name>\ndata: <json>\n\n`):
 *
 *   event: meta
 *   data: {"conversationId": "<uuid>"}
 *     Always the first event, exactly once -- lets a client that POSTed
 *     without a :conversationId (starting a new conversation) learn the
 *     generated id before anything else arrives.
 *
 *   event: text
 *   data: {"text": "<chunk>"}
 *     One event per complete assistant text block. See chat-service.ts's
 *     doc comment for why this is block-level, not per-token, granularity.
 *
 *   event: tool
 *   data: {"name": "<tool_name>", "status": "<status, es-EC>"}
 *     One event per tool call the model makes, e.g.
 *     {"name":"query_transactions","status":"consultando el libro contable…"}
 *
 *   event: done
 *   data: {"assistantText": "<full final answer>"}
 *     Terminal on success. The stream is closed immediately after.
 *
 *   event: error
 *   data: {"message": "<error message>"}
 *     Terminal on failure (SDK/network error, or an aborted query -- see
 *     below). The stream is closed immediately after. Only ever sent AFTER
 *     the stream has started (headers already flushed as 200) -- the
 *     no-credential case is reported as a plain JSON 503 instead, before any
 *     SSE framing begins (see below).
 *
 * NO-CREDENTIAL: checked up front (mirrors sync/build-sync-runner.ts's
 * EITHER-credential gate -- ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN)
 * before any SSE headers are written, so it can be reported as a clean JSON
 * 503 like POST /api/sync's own "gmail_not_configured" path, rather than a
 * mid-stream `error` event.
 *
 * CLIENT DISCONNECT: an `AbortController` is created per request and wired
 * to the request's `close` event; aborting mid-turn makes chat-service's
 * `runChatTurn` throw, which this route catches -- writing an `error` event
 * only if the response can still be written to (`!res.writableEnded`), never
 * crashing the server.
 */
import type Database from "better-sqlite3";
import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import {
  createConversation,
  getConversation,
  listConversations,
  listMessages,
} from "../chat/conversation-repository.js";
import { runChatTurn, type QueryFn } from "../chat/chat-service.js";

const chatBodySchema = z.object({ message: z.string().min(1) });

export interface ChatRouterDeps {
  getDb: () => Database.Database;
  /** True iff either ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN is set --
   * see sync/build-sync-runner.ts for the same EITHER-credential shape. */
  hasCredential: () => boolean;
  /** Overrides the real Claude Agent SDK `query()` call inside
   * chat-service.ts. Omit to use the real SDK. */
  queryFn?: QueryFn;
}

function writeEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function createChatRouter(deps: ChatRouterDeps): Router {
  const router = Router();

  router.get("/conversations", (_req, res) => {
    res.json({ conversations: listConversations(deps.getDb()) });
  });

  router.get("/conversations/:id", (req, res) => {
    const db = deps.getDb();
    const conversation = getConversation(db, req.params.id);
    if (!conversation) {
      res.status(404).json({ error: "conversation not found" });
      return;
    }
    res.json({ conversation, messages: listMessages(db, conversation.id) });
  });

  router.post("/chat/:conversationId?", async (req, res) => {
    if (!deps.hasCredential()) {
      res.status(503).json({ error: "claude_not_configured" });
      return;
    }

    const parsedBody = chatBodySchema.safeParse(req.body);
    if (!parsedBody.success) {
      res.status(400).json({ error: "invalid body", details: parsedBody.error.flatten() });
      return;
    }

    const db = deps.getDb();
    const conversation = req.params.conversationId
      ? getConversation(db, req.params.conversationId)
      : createConversation(db);
    if (!conversation) {
      res.status(404).json({ error: "conversation not found" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    writeEvent(res, "meta", { conversationId: conversation.id });

    const abortController = new AbortController();
    const onClose = () => abortController.abort();
    req.on("close", onClose);

    try {
      await runChatTurn({
        db,
        conversationId: conversation.id,
        userText: parsedBody.data.message,
        queryFn: deps.queryFn,
        abortController,
        onEvent: (event) => {
          if (res.writableEnded) return;
          if (event.type === "text") {
            writeEvent(res, "text", { text: event.text });
          } else if (event.type === "tool") {
            writeEvent(res, "tool", { name: event.name, status: event.status });
          } else {
            writeEvent(res, "done", { assistantText: event.assistantText });
          }
        },
      });
    } catch (err) {
      if (!res.writableEnded) {
        writeEvent(res, "error", { message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      req.off("close", onClose);
      if (!res.writableEnded) res.end();
    }
  });

  return router;
}
