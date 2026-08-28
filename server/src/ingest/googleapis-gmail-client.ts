/**
 * Real `GmailClient` (spec §6.1, Plan B per the claude-agent-sdk-gmail
 * skill): `googleapis` OAuth2 + `gmail.users.messages.list`/`.get`,
 * read-only (`gmail.readonly` scope, enforced again here at the code layer
 * by simply never implementing `send`/`modify`/`delete`). `googleapis` is
 * imported lazily inside the factory so the mocked unit-test path (the
 * in-memory fake `GmailClient` used by pipeline.test.ts) never needs the
 * real package to resolve at module-load time.
 */
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

function decodeBody(payload: { mimeType?: string | null; parts?: unknown[]; body?: { data?: string | null } } | undefined): string {
  if (!payload) return "";
  const parts = (payload.parts ?? []) as Array<{ mimeType?: string | null; body?: { data?: string | null } }>;
  const plainTextPart = parts.find((p) => p.mimeType === "text/plain");
  const data = plainTextPart?.body?.data ?? payload.body?.data ?? "";
  if (!data) return "";
  // Gmail returns body data base64url-encoded — decoding as plain base64
  // silently corrupts '-'/'_' characters (see the skill's Common Pitfalls).
  return Buffer.from(data, "base64url").toString("utf-8");
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
