import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../db/schema.js";
import {
  appendMessage,
  createConversation,
  getConversation,
  listConversations,
  listMessages,
} from "./conversation-repository.js";

let db: Database.Database;

beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
});

describe("createConversation", () => {
  it("creates a new conversation with a UUID id and ISO created_at/updated_at", () => {
    const conversation = createConversation(db);

    expect(conversation.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(conversation.created_at).toBe(conversation.updated_at);
    expect(new Date(conversation.created_at).toISOString()).toBe(conversation.created_at);
  });

  it("is retrievable via getConversation", () => {
    const conversation = createConversation(db);

    const fetched = getConversation(db, conversation.id);

    expect(fetched).toEqual(conversation);
  });
});

describe("getConversation", () => {
  it("returns undefined when not found", () => {
    expect(getConversation(db, "does-not-exist")).toBeUndefined();
  });
});

describe("appendMessage", () => {
  it("persists a user message with a UUID id and ISO ts", () => {
    const conversation = createConversation(db);

    const message = appendMessage(db, { conversationId: conversation.id, role: "user", content: "hola" });

    expect(message.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(message.conversation_id).toBe(conversation.id);
    expect(message.role).toBe("user");
    expect(message.content).toBe("hola");
    expect(new Date(message.ts).toISOString()).toBe(message.ts);
  });

  it("persists an assistant message", () => {
    const conversation = createConversation(db);

    const message = appendMessage(db, { conversationId: conversation.id, role: "assistant", content: "hi" });

    expect(message.role).toBe("assistant");
  });

  it("bumps the parent conversation's updated_at", async () => {
    const conversation = createConversation(db);

    // ensure the message ts is strictly after created_at even at low clock resolution
    await new Promise((resolve) => setTimeout(resolve, 5));
    const message = appendMessage(db, { conversationId: conversation.id, role: "user", content: "hola" });

    const updated = getConversation(db, conversation.id);
    expect(updated?.updated_at).toBe(message.ts);
    expect(updated?.updated_at).not.toBe(conversation.created_at);
  });

  it("rejects an invalid role and leaves no row behind", () => {
    const conversation = createConversation(db);

    expect(() => appendMessage(db, { conversationId: conversation.id, role: "system", content: "x" })).toThrow();

    expect(listMessages(db, conversation.id)).toHaveLength(0);
  });

  it("rejects a missing conversation_id and leaves no row behind", () => {
    expect(() => appendMessage(db, { conversationId: "does-not-exist", role: "user", content: "x" })).toThrow();

    const count = db.prepare("SELECT COUNT(*) as c FROM messages").get() as { c: number };
    expect(count.c).toBe(0);
  });
});

describe("listMessages", () => {
  it("returns a conversation's messages in ts-ascending order", async () => {
    const conversation = createConversation(db);

    const first = appendMessage(db, { conversationId: conversation.id, role: "user", content: "one" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = appendMessage(db, { conversationId: conversation.id, role: "assistant", content: "two" });

    const messages = listMessages(db, conversation.id);

    expect(messages.map((m) => m.id)).toEqual([first.id, second.id]);
  });

  it("returns an empty array for a conversation with no messages", () => {
    const conversation = createConversation(db);

    expect(listMessages(db, conversation.id)).toEqual([]);
  });

  it("does not mix messages from other conversations", () => {
    const a = createConversation(db);
    const b = createConversation(db);
    appendMessage(db, { conversationId: a.id, role: "user", content: "in a" });
    appendMessage(db, { conversationId: b.id, role: "user", content: "in b" });

    expect(listMessages(db, a.id).map((m) => m.content)).toEqual(["in a"]);
  });
});

describe("listConversations", () => {
  it("orders conversations by updated_at, newest first", async () => {
    const older = createConversation(db);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newer = createConversation(db);

    expect(listConversations(db).map((c) => c.id)).toEqual([newer.id, older.id]);
  });

  it("moves a conversation to the front once appendMessage bumps its updated_at", async () => {
    const first = createConversation(db);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = createConversation(db);
    await new Promise((resolve) => setTimeout(resolve, 5));
    appendMessage(db, { conversationId: first.id, role: "user", content: "latest reply" });

    const conversations = listConversations(db);

    expect(conversations.map((c) => c.id)).toEqual([first.id, second.id]);
    expect(conversations.find((c) => c.id === first.id)?.last_message).toBe("latest reply");
    expect(conversations.find((c) => c.id === second.id)?.last_message).toBeNull();
  });
});
