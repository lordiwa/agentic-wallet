import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { migrate } from "../db/schema.js";
import { createApp } from "../index.js";
import type { QueryFn } from "../chat/chat-service.js";

async function* messages(...msgs: unknown[]) {
  for (const m of msgs) yield m;
}

function makeApp(queryFn?: QueryFn, chatCredential = true) {
  const db = new Database(":memory:");
  migrate(db);
  return { db, app: createApp(db, { syncRunner: null, chatCredential, chatQueryFn: queryFn }) };
}

/** Splits a raw SSE response body into { event, data } records. */
function parseSse(text: string): Array<{ event: string; data: unknown }> {
  return text
    .split("\n\n")
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const eventLine = chunk.split("\n").find((l) => l.startsWith("event: "));
      const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
      return {
        event: eventLine?.slice("event: ".length) ?? "",
        data: dataLine ? JSON.parse(dataLine.slice("data: ".length)) : undefined,
      };
    });
}

describe("POST /api/chat", () => {
  it("streams meta, tool, text, and a terminal done event, then persists the turn under a new conversation", async () => {
    const fakeQuery: QueryFn = () =>
      messages(
        { type: "assistant", message: { content: [{ type: "tool_use", name: "get_strategy_overview" }] } },
        { type: "assistant", message: { content: [{ type: "text", text: "Tu safe-to-spend hoy es $8.40." }] } },
        { type: "result", subtype: "success", result: "Tu safe-to-spend hoy es $8.40." }
      );
    const { app } = makeApp(fakeQuery);

    const res = await request(app)
      .post("/api/chat")
      .send({ message: "¿Cuánto puedo gastar hoy?" })
      .expect(200)
      .expect("Content-Type", /text\/event-stream/);

    const events = parseSse(res.text);
    expect(events.map((e) => e.event)).toEqual(["meta", "tool", "text", "done"]);
    expect(events[0].data).toHaveProperty("conversationId");
    expect(events[1].data).toEqual({
      name: "get_strategy_overview",
      status: expect.stringContaining("resumen de estrategia"),
    });
    expect(events[2].data).toEqual({ text: "Tu safe-to-spend hoy es $8.40." });
    expect(events[3].data).toEqual({ assistantText: "Tu safe-to-spend hoy es $8.40." });

    const conversationId = (events[0].data as { conversationId: string }).conversationId;
    const history = await request(app).get(`/api/conversations/${conversationId}`).expect(200);
    expect(history.body.messages.map((m: { role: string; content: string }) => [m.role, m.content])).toEqual([
      ["user", "¿Cuánto puedo gastar hoy?"],
      ["assistant", "Tu safe-to-spend hoy es $8.40."],
    ]);

    const list = await request(app).get("/api/conversations").expect(200);
    expect(list.body.conversations.map((c: { id: string }) => c.id)).toEqual([conversationId]);
  });

  it("continues an existing conversation when :conversationId is given", async () => {
    const fakeQuery: QueryFn = () => messages({ type: "result", subtype: "success", result: "segunda respuesta" });
    const { app } = makeApp(fakeQuery);

    const first = await request(app).post("/api/chat").send({ message: "primer mensaje" }).expect(200);
    const conversationId = parseSse(first.text)[0].data as { conversationId: string };

    await request(app)
      .post(`/api/chat/${conversationId.conversationId}`)
      .send({ message: "segundo mensaje" })
      .expect(200);

    const history = await request(app).get(`/api/conversations/${conversationId.conversationId}`).expect(200);
    expect(history.body.messages).toHaveLength(4);
    expect(history.body.messages[2].content).toBe("segundo mensaje");
    expect(history.body.messages[3].content).toBe("segunda respuesta");
  });

  it("returns a clean 404 (not a crash) for an unknown conversationId", async () => {
    const { app } = makeApp(() => messages());

    await request(app).post("/api/chat/does-not-exist").send({ message: "hola" }).expect(404);
  });

  it("returns a clean 400 for a missing/blank message body", async () => {
    const { app } = makeApp(() => messages());

    await request(app).post("/api/chat").send({}).expect(400);
  });

  it("returns a clean 503 (not a crash) when neither Claude credential is configured", async () => {
    const { app } = makeApp(undefined, false);

    const res = await request(app).post("/api/chat").send({ message: "hola" }).expect(503);

    expect(res.body).toEqual({ error: "claude_not_configured" });
  });

  it("emits a terminal error event (not a crash) when the underlying query throws mid-turn", async () => {
    const fakeQuery: QueryFn = async function* () {
      yield { type: "assistant", message: { content: [{ type: "text", text: "empezando…" }] } };
      throw new Error("network blip");
    };
    const { app, db } = makeApp(fakeQuery);

    const res = await request(app).post("/api/chat").send({ message: "hola" }).expect(200);

    const events = parseSse(res.text);
    expect(events.map((e) => e.event)).toEqual(["meta", "text", "error"]);
    expect(events[2].data).toEqual({ message: "network blip" });

    // The user's turn is still persisted even though the assistant's failed.
    const conversationId = (events[0].data as { conversationId: string }).conversationId;
    const count = db.prepare("SELECT COUNT(*) as c FROM messages WHERE conversation_id = ?").get(conversationId) as {
      c: number;
    };
    expect(count.c).toBe(1);
  });
});

describe("GET /api/conversations/:id", () => {
  it("returns 404 for an unknown id", async () => {
    const { app } = makeApp();

    await request(app).get("/api/conversations/does-not-exist").expect(404);
  });
});
