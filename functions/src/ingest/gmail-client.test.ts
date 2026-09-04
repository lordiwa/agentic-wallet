/**
 * El cliente de Gmail, con `fetch` mockeado. Nunca toca la red ni un buzón
 * real: lo que se verifica es la decodificación (base64url, elección de parte,
 * HTML→texto) y la paginación, que son las dos cosas que un correo real puede
 * romper en silencio.
 */
import { describe, expect, it, vi } from "vitest";
import { crearClienteGmail, decodificarCuerpo, GmailError, type FetchLike } from "./gmail-client.js";

function b64url(texto: string): string {
  return Buffer.from(texto, "utf8").toString("base64url");
}

function respuesta(cuerpo: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => cuerpo } as unknown as Response;
}

describe("decodificarCuerpo", () => {
  it("prefiere text/plain", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64url("soy el plano") } },
        { mimeType: "text/html", body: { data: b64url("<p>soy el html</p>") } },
      ],
    };
    expect(decodificarCuerpo(payload)).toBe("soy el plano");
  });

  /** El bug que documenta el cliente del motor: el `text/plain` cuelga a veces
   * de un `multipart/alternative` anidado dentro de un `multipart/mixed`. */
  it("encuentra el text/plain anidado en profundidad", () => {
    const payload = {
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "image/png", body: { data: b64url("no soy texto") } },
        {
          mimeType: "multipart/alternative",
          parts: [{ mimeType: "text/plain", body: { data: b64url("el de adentro") } }],
        },
      ],
    };
    expect(decodificarCuerpo(payload)).toBe("el de adentro");
  });

  it("convierte el HTML en vez de devolver el marcado crudo", () => {
    const payload = {
      mimeType: "multipart/alternative",
      parts: [{ mimeType: "text/html", body: { data: b64url("<P>Valor:</P><P>USD 1.00</P>") } }],
    };
    const texto = decodificarCuerpo(payload);
    expect(texto).toContain("USD 1.00");
    expect(texto).not.toContain("<P>");
  });

  it("un correo de una sola parte trae el mimeType en la raiz", () => {
    expect(decodificarCuerpo({ mimeType: "text/plain", body: { data: b64url("solo esto") } })).toBe("solo esto");
  });

  /** base64**url**: decodificar como base64 comun corrompe '-' y '_'. */
  it("decodifica base64url y no base64 a secas", () => {
    const conGuiones = Buffer.from("año ~ 100% ok", "utf8").toString("base64url");
    expect(decodificarCuerpo({ mimeType: "text/plain", body: { data: conGuiones } })).toBe("año ~ 100% ok");
  });

  it("sin payload devuelve vacio en vez de romper", () => {
    expect(decodificarCuerpo(undefined)).toBe("");
  });
});

describe("crearClienteGmail", () => {
  it("manda el access token y pide solo lo que falta para el limite", async () => {
    const fetchImpl = vi.fn(async () => respuesta({ messages: [{ id: "a" }, { id: "b" }] })) as unknown as FetchLike;

    const ids = await crearClienteGmail("token-de-prueba", fetchImpl).buscarIds("from:banco", 2);

    expect(ids).toEqual(["a", "b"]);
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toContain("maxResults=2");
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer token-de-prueba");
  });

  it("pagina hasta el limite y no lo pasa", async () => {
    let llamada = 0;
    const fetchImpl = (async () => {
      llamada += 1;
      return llamada === 1
        ? respuesta({ messages: [{ id: "a" }, { id: "b" }], nextPageToken: "p2" })
        : respuesta({ messages: [{ id: "c" }, { id: "d" }] });
    }) as unknown as FetchLike;

    expect(await crearClienteGmail("t", fetchImpl).buscarIds("q", 3)).toEqual(["a", "b", "c"]);
  });

  it("un error de Gmail viaja como GmailError con su status", async () => {
    const fetchImpl = (async () => respuesta({}, false, 403)) as unknown as FetchLike;
    await expect(crearClienteGmail("t", fetchImpl).buscarIds("q", 1)).rejects.toBeInstanceOf(GmailError);
  });

  it("leerMensaje arma el mensaje con asunto, hilo y ts", async () => {
    const fetchImpl = (async () =>
      respuesta({
        id: "msg-1",
        threadId: "hilo-1",
        internalDate: "1788700000000",
        payload: {
          headers: [{ name: "Subject", value: "Consumo por USD 1.00" }],
          mimeType: "text/plain",
          body: { data: b64url("Valor: USD 1.00") },
        },
      })) as unknown as FetchLike;

    const msg = await crearClienteGmail("t", fetchImpl).leerMensaje("msg-1");

    expect(msg).toMatchObject({
      gmail_msg_id: "msg-1",
      gmail_thread_id: "hilo-1",
      subject: "Consumo por USD 1.00",
      body: "Valor: USD 1.00",
    });
    expect(msg.ts).toBe(new Date(1788700000000).toISOString());
  });

  it("el header Subject se busca sin importar como venga capitalizado", async () => {
    const fetchImpl = (async () =>
      respuesta({
        id: "m",
        payload: { headers: [{ name: "subject", value: "en minuscula" }], mimeType: "text/plain", body: {} },
      })) as unknown as FetchLike;
    expect((await crearClienteGmail("t", fetchImpl).leerMensaje("m")).subject).toBe("en minuscula");
  });
});
