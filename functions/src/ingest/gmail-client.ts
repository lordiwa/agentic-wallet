/**
 * Lectura de Gmail desde una Cloud Function, sobre la API REST con `fetch`.
 *
 * **Por qué no `googleapis`.** El motor usa ese paquete
 * (`server/src/ingest/googleapis-gmail-client.ts`), y acá sería ~15 MB de
 * dependencia para usar dos endpoints. Lo que ese paquete aporta de verdad es
 * el refresco del access token, y en Functions eso ya está resuelto: el
 * refresh token cifrado sale de Firestore y se canjea con `oauth/google.ts`.
 *
 * **Sólo lectura, y no por el scope.** Esta interfaz tiene `buscarIds` y
 * `leerMensaje` y nada más. No hay `send`, `modify` ni `delete` que llamar aun
 * si algún día el token viniera con permisos de más — la misma decisión que el
 * motor toma en su cliente.
 *
 * La decodificación del cuerpo (base64url, elección de parte, HTML→texto,
 * mojibake) es la MISMA del motor y por el mismo motivo: los correos reales de
 * Produbanco a veces traen el `text/plain` colgando de un `multipart/mixed`
 * anidado, y a veces llegan con los bytes UTF-8 doble-encodeados por el mailer.
 */
import { htmlToText } from "../parser/html-text.js";
import { repairMojibake } from "./mojibake.js";

/** Un mensaje ya decodificado a texto plano. Mismo contrato que
 * `server/src/ingest/types.ts`, para que el parser copiado no note diferencia. */
export interface MensajeGmail {
  gmail_msg_id: string;
  gmail_thread_id: string | null;
  subject: string;
  body: string;
  /** ISO-8601 del `internalDate` que Gmail le asignó. */
  ts: string;
}

export interface ClienteGmail {
  buscarIds(query: string, limite: number): Promise<string[]>;
  leerMensaje(id: string): Promise<MensajeGmail>;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** El tope de `messages.list` de Gmail. Pedir más es un 400. */
const PAGINA_MAX = 500;

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

export class GmailError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "GmailError";
  }
}

interface ParteMensaje {
  mimeType?: string | null;
  parts?: unknown[];
  body?: { data?: string | null };
}

/** Gmail manda el cuerpo en base64**url**: decodificarlo como base64 comun
 * corrompe los '-' y '_' en silencio. */
function decodificarParte(parte: ParteMensaje | undefined): string {
  const data = parte?.body?.data;
  return data ? repairMojibake(Buffer.from(data, "base64url").toString("utf-8")) : "";
}

/** Primer descendiente con este mimeType, en profundidad: la estructura del
 * correo no es siempre la misma y mirar sólo el primer nivel encontraba el
 * cuerpo en unos correos y no en otros. */
function buscarParte(parte: ParteMensaje | undefined, mimeType: string): ParteMensaje | undefined {
  if (!parte) return undefined;
  if (parte.mimeType === mimeType && parte.body?.data) return parte;
  for (const hijo of (parte.parts ?? []) as ParteMensaje[]) {
    const encontrada = buscarParte(hijo, mimeType);
    if (encontrada) return encontrada;
  }
  return undefined;
}

/**
 * Cuerpo como texto plano. Se prefiere `text/plain`; si sólo hay `text/html`
 * se convierte en vez de devolverlo crudo — devolverlo crudo hacía que el
 * parser guardara contrapartes llenas de marcado.
 */
export function decodificarCuerpo(payload: ParteMensaje | undefined): string {
  if (!payload) return "";

  const plano = decodificarParte(buscarParte(payload, "text/plain"));
  if (plano) return plano;

  const html = decodificarParte(buscarParte(payload, "text/html"));
  if (html) return htmlToText(html);

  // Correo de una sola parte: el mimeType vive en la raíz.
  const raiz = decodificarParte(payload);
  return payload.mimeType === "text/html" ? htmlToText(raiz) : raiz;
}

interface RespuestaLista {
  messages?: { id?: string }[];
  nextPageToken?: string;
}

interface RespuestaMensaje {
  id?: string;
  threadId?: string;
  internalDate?: string;
  payload?: ParteMensaje & { headers?: { name?: string; value?: string }[] };
}

/**
 * El cliente, atado a un access token ya vigente.
 *
 * El access token va por parámetro y no se refresca acá adentro: quién tiene
 * el refresh token —y quién puede marcarlo inválido— es `oauth/gmail-tokens.ts`,
 * y meter esa responsabilidad en el lector de correo le daría a este módulo
 * acceso a la clave maestra sin necesitarlo.
 */
export function crearClienteGmail(accessToken: string, fetchImpl: FetchLike = fetch): ClienteGmail {
  async function pedir<T>(url: string): Promise<T> {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      throw new GmailError(`Gmail respondio ${res.status}`, res.status);
    }
    return (await res.json()) as T;
  }

  return {
    async buscarIds(query: string, limite: number): Promise<string[]> {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        // Se pide sólo lo que falta para el límite: traer 500 ids para
        // procesar 25 es una llamada más grande sin ningún uso.
        const faltan = Math.min(limite - ids.length, PAGINA_MAX);
        const params = new URLSearchParams({ q: query, maxResults: String(faltan) });
        if (pageToken !== undefined) params.set("pageToken", pageToken);
        const data = await pedir<RespuestaLista>(`${BASE}/messages?${params.toString()}`);
        for (const m of data.messages ?? []) {
          if (m.id !== undefined) ids.push(m.id);
        }
        pageToken = data.nextPageToken;
      } while (pageToken !== undefined && ids.length < limite);
      return ids.slice(0, limite);
    },

    async leerMensaje(id: string): Promise<MensajeGmail> {
      const data = await pedir<RespuestaMensaje>(`${BASE}/messages/${encodeURIComponent(id)}?format=full`);
      const headers = data.payload?.headers ?? [];
      const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "";
      return {
        gmail_msg_id: data.id ?? id,
        gmail_thread_id: data.threadId ?? null,
        subject,
        body: decodificarCuerpo(data.payload),
        ts:
          data.internalDate !== undefined
            ? new Date(Number(data.internalDate)).toISOString()
            : new Date().toISOString(),
      };
    },
  };
}
