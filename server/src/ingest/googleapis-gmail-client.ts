/**
 * Real `GmailClient` (spec §6.1, Plan B per the claude-agent-sdk-gmail
 * skill): `googleapis` OAuth2 + `gmail.users.messages.list`/`.get`,
 * read-only (`gmail.readonly` scope, enforced again here at the code layer
 * by simply never implementing `send`/`modify`/`delete`). `googleapis` is
 * imported lazily inside the factory so the mocked unit-test path (the
 * in-memory fake `GmailClient` used by pipeline.test.ts) never needs the
 * real package to resolve at module-load time.
 */
import { htmlToText } from "../parser/html-text.js";
import type { GmailClient, GmailMessage } from "./types.js";

export interface GoogleapisGmailClientConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

// Gmail's own list-results cap for messages.list is 500; 50 keeps each page
// small and each `getMessage` batch bounded, matching the ticket's "pages
// of 50" guidance.
const PAGE_SIZE = 50;

interface MessagePart {
  mimeType?: string | null;
  parts?: unknown[];
  body?: { data?: string | null };
}

// Gmail returns body data base64url-encoded — decoding as plain base64
// silently corrupts '-'/'_' characters (see the skill's Common Pitfalls).
function decodePartData(part: MessagePart | undefined): string {
  const data = part?.body?.data;
  return data ? Buffer.from(data, "base64url").toString("utf-8") : "";
}

/** Primer descendiente con este mimeType, en profundidad. Produbanco no manda
 * siempre la misma estructura: a veces el `text/plain` cuelga de la raíz y a
 * veces de un `multipart/alternative` anidado dentro de un `multipart/mixed`
 * (cuando el correo trae adjunto o imagen embebida). Mirar sólo el primer
 * nivel encontraba el cuerpo en unos correos y no en otros. */
function findPart(part: MessagePart | undefined, mimeType: string): MessagePart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mimeType && part.body?.data) return part;
  for (const child of (part.parts ?? []) as MessagePart[]) {
    const found = findPart(child, mimeType);
    if (found) return found;
  }
  return undefined;
}

/**
 * Cuerpo del correo como texto plano.
 *
 * Se prefiere `text/plain`; si el correo sólo trae `text/html` se convierte
 * en vez de devolverlo crudo. Devolverlo crudo era un fallo silencioso: el
 * parser aplicaba sus regex sobre el marcado y guardaba contrapartes como
 * `"</STRONG><SPAN>&nbsp;</SPAN>NOMBRE<BR><STRONG>Banco"`, que además rompen
 * el matching por substring de `category/categorize.ts`.
 */
function decodeBody(payload: MessagePart | undefined): string {
  if (!payload) return "";

  const plain = decodePartData(findPart(payload, "text/plain"));
  if (plain) return plain;

  const html = decodePartData(findPart(payload, "text/html"));
  if (html) return htmlToText(html);

  // Correo de una sola parte: el mimeType vive en la raíz.
  const root = decodePartData(payload);
  return payload.mimeType === "text/html" ? htmlToText(root) : root;
}

/**
 * Builds a real, read-only `GmailClient` backed by `googleapis`. Never
 * called from tests (which use an in-memory fake); exercised indirectly by
 * googleapis-gmail-client.test.ts via `vi.mock("googleapis")`.
 */
export async function createGoogleapisGmailClient(config: GoogleapisGmailClientConfig): Promise<GmailClient> {
  const { google } = await import("googleapis");
  const oauth2Client = new google.auth.OAuth2(config.clientId, config.clientSecret);
  oauth2Client.setCredentials({ refresh_token: config.refreshToken });
  const gmail = google.gmail({ version: "v1", auth: oauth2Client });

  return {
    async searchMessageIds(query: string): Promise<string[]> {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const { data } = await gmail.users.messages.list({
          userId: "me",
          q: query,
          maxResults: PAGE_SIZE,
          pageToken,
        });
        for (const message of data.messages ?? []) {
          if (message.id) ids.push(message.id);
        }
        pageToken = data.nextPageToken ?? undefined;
      } while (pageToken);
      return ids;
    },

    async getMessage(id: string): Promise<GmailMessage> {
      const { data } = await gmail.users.messages.get({ userId: "me", id, format: "full" });
      const headers = data.payload?.headers ?? [];
      const subject = headers.find((h) => h.name?.toLowerCase() === "subject")?.value ?? "";
      const body = decodeBody(data.payload ?? undefined);
      const ts = data.internalDate ? new Date(Number(data.internalDate)).toISOString() : new Date().toISOString();

      return {
        gmail_msg_id: data.id ?? id,
        gmail_thread_id: data.threadId ?? null,
        subject,
        body,
        ts,
      };
    },
  };
}
