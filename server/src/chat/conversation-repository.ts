import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export interface ConversationRow {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationSummary extends ConversationRow {
  last_message: string | null;
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  ts: string;
}

export interface NewMessage {
  conversationId: string;
  role: string;
  content: string;
}

const VALID_ROLES = new Set(["user", "assistant"]);

/** Creates a new, empty conversation with created_at === updated_at. */
export function createConversation(db: Database.Database): ConversationRow {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO conversations (id, created_at, updated_at) VALUES (@id, @created_at, @updated_at)`).run({
    id,
    created_at: now,
    updated_at: now,
  });
  return { id, created_at: now, updated_at: now };
}

export function getConversation(db: Database.Database, id: string): ConversationRow | undefined {
  return db.prepare("SELECT * FROM conversations WHERE id = ?").get(id) as ConversationRow | undefined;
}

/**
 * Persists a user/assistant turn and bumps the parent conversation's
 * updated_at in the same transaction. Role and conversation existence are
 * validated up front — before any write — so an invalid call never leaves an
 * orphaned or half-written row behind (matches the up-front-validation style
 * used elsewhere in server/src/db/repository.ts).
 */
export function appendMessage(db: Database.Database, message: NewMessage): MessageRow {
  if (!VALID_ROLES.has(message.role)) {
    throw new Error(`appendMessage: invalid role "${message.role}" (expected "user" or "assistant")`);
  }
  if (!getConversation(db, message.conversationId)) {
    throw new Error(`appendMessage: no conversation found for id ${message.conversationId}`);
  }

  const id = randomUUID();
  const ts = new Date().toISOString();
  const row: MessageRow = { id, conversation_id: message.conversationId, role: message.role, content: message.content, ts };

  const persist = db.transaction(() => {
    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, ts) VALUES (@id, @conversation_id, @role, @content, @ts)`
    ).run(row);
    db.prepare(`UPDATE conversations SET updated_at = @ts WHERE id = @id`).run({ id: message.conversationId, ts });
  });
  persist();

  return row;
}

/** Returns a conversation's messages in ts-ascending (chronological) order. */
export function listMessages(db: Database.Database, conversationId: string): MessageRow[] {
  return db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY ts ASC").all(conversationId) as MessageRow[];
}

/** Returns all conversations newest-first, each with its last message as a preview. */
export function listConversations(db: Database.Database): ConversationSummary[] {
  return db
    .prepare(
      `SELECT
        c.id AS id,
        c.created_at AS created_at,
        c.updated_at AS updated_at,
        (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.ts DESC LIMIT 1) AS last_message
      FROM conversations c
      ORDER BY c.updated_at DESC`
    )
    .all() as ConversationSummary[];
}
