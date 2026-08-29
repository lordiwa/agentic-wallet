import { describe, expect, it, vi } from "vitest";

// Mocks the `googleapis` boundary per the ticket's "never make a live
// network call" rule. Verifies pagination (nextPageToken across pages) and
// base64url body decoding against the real production client code — not a
// hand-rolled fake, this exercises googleapis-gmail-client.ts itself.
const listMock = vi.fn();
const getMock = vi.fn();
const setCredentialsMock = vi.fn();

vi.mock("googleapis", () => {
  return {
    google: {
      auth: {
        OAuth2: vi.fn().mockImplementation(() => ({
          setCredentials: setCredentialsMock,
        })),
      },
      gmail: vi.fn().mockReturnValue({
        users: {
          messages: {
            list: listMock,
            get: getMock,
          },
        },
      }),
    },
  };
});

describe("createGoogleapisGmailClient", () => {
  it("configures OAuth2 credentials from the refresh token", async () => {
    listMock.mockResolvedValueOnce({ data: { messages: [] } });
    const { createGoogleapisGmailClient } = await import("./googleapis-gmail-client.js");

    const client = await createGoogleapisGmailClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
    });
    await client.searchMessageIds("from:produbanco");

    expect(setCredentialsMock).toHaveBeenCalledWith({ refresh_token: "refresh-token" });
  });

  it("paginates across multiple pages until nextPageToken is exhausted", async () => {
    listMock.mockReset();
    listMock
      .mockResolvedValueOnce({
        data: { messages: [{ id: "a" }, { id: "b" }], nextPageToken: "page-2" },
      })
      .mockResolvedValueOnce({
        data: { messages: [{ id: "c" }], nextPageToken: null },
      });
    const { createGoogleapisGmailClient } = await import("./googleapis-gmail-client.js");

    const client = await createGoogleapisGmailClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
    });
    const ids = await client.searchMessageIds("from:produbanco after:2026/07/01");

    expect(ids).toEqual(["a", "b", "c"]);
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(listMock.mock.calls[1][0]).toMatchObject({ pageToken: "page-2" });
  });

  it("decodes a base64url-encoded plain-text body and extracts the Subject header", async () => {
    getMock.mockReset();
    const rawBody = Buffer.from("Hola desde Produbanco, USD 9.42").toString("base64url");
    getMock.mockResolvedValueOnce({
      data: {
        id: "msg-1",
        threadId: "thread-1",
        internalDate: "1751328000000",
        payload: {
          headers: [{ name: "Subject", value: "Consumo tarjeta de débito por USD 9.42" }],
          parts: [{ mimeType: "text/plain", body: { data: rawBody } }],
        },
      },
    });
    const { createGoogleapisGmailClient } = await import("./googleapis-gmail-client.js");

    const client = await createGoogleapisGmailClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
    });
    const message = await client.getMessage("msg-1");

    expect(message.gmail_msg_id).toBe("msg-1");
    expect(message.gmail_thread_id).toBe("thread-1");
    expect(message.subject).toBe("Consumo tarjeta de débito por USD 9.42");
    expect(message.body).toBe("Hola desde Produbanco, USD 9.42");
  });

  it("encuentra el text/plain anidado dentro de un multipart, no solo el del primer nivel", async () => {
    // Produbanco alterna estructuras: con adjunto o imagen embebida el
    // text/plain cuelga de un multipart/alternative dentro de un
    // multipart/mixed. Mirar solo el primer nivel caia al body crudo de la
    // raiz (HTML) en esos correos y no en los demas.
    getMock.mockReset();
    const rawBody = Buffer.from("Contacto: ANA PEREZ").toString("base64url");
    getMock.mockResolvedValueOnce({
      data: {
        id: "msg-2",
        threadId: "thread-2",
        internalDate: "1751328000000",
        payload: {
          mimeType: "multipart/mixed",
          headers: [{ name: "Subject", value: "Transferencia enviada" }],
          parts: [
            {
              mimeType: "multipart/alternative",
              parts: [{ mimeType: "text/plain", body: { data: rawBody } }],
            },
          ],
        },
      },
    });
    const { createGoogleapisGmailClient } = await import("./googleapis-gmail-client.js");

    const client = await createGoogleapisGmailClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
    });
    const message = await client.getMessage("msg-2");

    expect(message.body).toBe("Contacto: ANA PEREZ");
  });

  it("convierte a texto el correo que solo trae text/html en vez de devolver el marcado", async () => {
    // El fallo que dejaba contrapartes como
    // "</STRONG><SPAN>&nbsp;</SPAN>NOMBRE<BR><STRONG>Banco" en la base.
    getMock.mockReset();
    const html = "<STRONG>Contacto:</STRONG><SPAN>&nbsp;</SPAN>ANA PEREZ<BR><STRONG>Banco Destino:</STRONG> Produbanco";
    getMock.mockResolvedValueOnce({
      data: {
        id: "msg-3",
        threadId: "thread-3",
        internalDate: "1751328000000",
        payload: {
          mimeType: "multipart/alternative",
          headers: [{ name: "Subject", value: "Transferencia enviada" }],
          parts: [{ mimeType: "text/html", body: { data: Buffer.from(html).toString("base64url") } }],
        },
      },
    });
    const { createGoogleapisGmailClient } = await import("./googleapis-gmail-client.js");

    const client = await createGoogleapisGmailClient({
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
    });
    const message = await client.getMessage("msg-3");

    expect(message.body).toBe("Contacto: ANA PEREZ\nBanco Destino: Produbanco");
  });
});
