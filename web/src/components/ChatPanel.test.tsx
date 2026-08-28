/** @vitest-environment jsdom */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installMockChatFetch, makeControlledSseStream } from "../test/mockChatFetch";
import { ChatPanel } from "./ChatPanel";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const isConversationsList = (url: string, init?: RequestInit) => url === "/api/conversations" && init?.method === undefined;
const isChatPost = (url: string, init?: RequestInit) => url === "/api/chat" && init?.method === "POST";

describe("ChatPanel", () => {
  it("loads and renders prior conversations from GET /api/conversations", async () => {
    installMockChatFetch([
      { match: isConversationsList, json: { conversations: [{ id: "c1", created_at: "t", updated_at: "t", last_message: "Hola" }] } },
    ]);

    render(<ChatPanel />);

    expect(await screen.findByRole("button", { name: "Hola" })).toBeInTheDocument();
  });

  it("streams assistant text incrementally, shows tool status while a tool runs, and clears it when text resumes", async () => {
    const chat = makeControlledSseStream();
    installMockChatFetch([
      { match: isConversationsList, json: { conversations: [] } },
      { match: isChatPost, stream: chat.stream },
    ]);
    const user = userEvent.setup();

    render(<ChatPanel />);
    await user.type(screen.getByLabelText("Mensaje"), "Cuanto tengo?");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    // AC: user message renders immediately; input disables while streaming.
    expect(screen.getByText(/Cuanto tengo\?/)).toBeInTheDocument();
    expect(screen.getByLabelText("Mensaje")).toBeDisabled();

    chat.push({ event: "meta", data: { conversationId: "c1" } });
    chat.push({ event: "tool", data: { name: "query_transactions", status: "consultando el libro contable..." } });
    expect(await screen.findByText("consultando el libro contable...")).toBeInTheDocument();

    chat.push({ event: "text", data: { text: "Hola, " } });
    await screen.findByText(/Hola,/);
    expect(screen.queryByText("consultando el libro contable...")).not.toBeInTheDocument();

    chat.push({ event: "text", data: { text: "tu saldo es 100." } });
    await screen.findByText(/Hola, tu saldo es 100\./);

    chat.push({ event: "done", data: { assistantText: "Hola, tu saldo es 100." } });
    chat.close();

    await waitFor(() => expect(screen.getByLabelText("Mensaje")).not.toBeDisabled());
    expect(screen.getByText(/Hola, tu saldo es 100\./)).toBeInTheDocument();
  });

  it("buffers a text frame split across two stream chunks and dispatches it only once complete", async () => {
    const chat = makeControlledSseStream();
    installMockChatFetch([
      { match: isConversationsList, json: { conversations: [] } },
      { match: isChatPost, stream: chat.stream },
    ]);
    const user = userEvent.setup();

    render(<ChatPanel />);
    await user.type(screen.getByLabelText("Mensaje"), "Cuanto tengo?");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    // Split mid "data:" line, before the "\n\n" frame separator has arrived.
    // A parser that (wrongly) treated each read() as one complete frame
    // would still fail to dispatch this specific split (the JSON is
    // incomplete), but a parser that dispatched on ANY buffered "data:" line
    // -- ignoring the missing separator -- would show partial text here.
    chat.pushRaw('event: text\ndata: {"tex');
    await new Promise((resolve) => setTimeout(resolve, 0)); // flush the pending reader.read()
    expect(screen.queryByText(/hola/)).not.toBeInTheDocument();

    // Completing chunk supplies the rest of the data line plus "\n\n".
    chat.pushRaw('t":"hola"}\n\n');
    await screen.findByText(/hola/);

    chat.push({ event: "done", data: { assistantText: "hola" } });
    chat.close();
    await waitFor(() => expect(screen.getByLabelText("Mensaje")).not.toBeDisabled());
  });

  it("drains multiple complete SSE frames delivered in a single chunk, in order", async () => {
    const chat = makeControlledSseStream();
    installMockChatFetch([
      { match: isConversationsList, json: { conversations: [] } },
      { match: isChatPost, stream: chat.stream },
    ]);
    const user = userEvent.setup();

    render(<ChatPanel />);
    await user.type(screen.getByLabelText("Mensaje"), "Cuanto tengo?");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    // Both frames arrive in ONE push (one reader.read() chunk) -- proves the
    // inner while-loop in streamChat drains every "\n\n"-delimited frame from
    // a single chunk instead of stopping after the first.
    chat.pushRaw(
      `event: tool\ndata: ${JSON.stringify({ name: "query_transactions", status: "consultando el libro contable..." })}\n\n` +
        `event: text\ndata: ${JSON.stringify({ text: "Hola" })}\n\n`,
    );

    await screen.findByText(/Hola/);
    // ChatPanel's onText clears toolStatus (AC2), so seeing it cleared here
    // -- rather than just both eventually appearing -- proves the tool frame
    // was dispatched BEFORE the text frame, i.e. in the order they were sent.
    expect(screen.queryByText("consultando el libro contable...")).not.toBeInTheDocument();

    chat.push({ event: "done", data: { assistantText: "Hola" } });
    chat.close();
    await waitFor(() => expect(screen.getByLabelText("Mensaje")).not.toBeDisabled());
  });

  it("switches to a prior conversation and loads its history in order", async () => {
    installMockChatFetch([
      { match: isConversationsList, json: { conversations: [{ id: "c1", created_at: "t", updated_at: "t", last_message: "Hola" }] } },
      {
        match: (url) => url === "/api/conversations/c1",
        json: {
          conversation: { id: "c1", created_at: "t", updated_at: "t" },
          messages: [
            { id: "m1", conversation_id: "c1", role: "user", content: "Cuanto tengo?", ts: "t1" },
            { id: "m2", conversation_id: "c1", role: "assistant", content: "Tienes 100.", ts: "t2" },
          ],
        },
      },
    ]);
    const user = userEvent.setup();

    render(<ChatPanel />);
    await user.click(await screen.findByRole("button", { name: "Hola" }));

    expect(await screen.findByText(/Cuanto tengo\?/)).toBeInTheDocument();
    expect(await screen.findByText(/Tienes 100\./)).toBeInTheDocument();
  });

  it("surfaces the no-credential 503 as an error rather than failing silently", async () => {
    installMockChatFetch([
      { match: isConversationsList, json: { conversations: [] } },
      { match: isChatPost, status: 503, ok: false, json: { error: "claude_not_configured" } },
    ]);
    const user = userEvent.setup();

    render(<ChatPanel />);
    await user.type(screen.getByLabelText("Mensaje"), "Hola");
    await user.click(screen.getByRole("button", { name: "Enviar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Claude no esta configurado");
    expect(screen.getByLabelText("Mensaje")).not.toBeDisabled();
  });
});
