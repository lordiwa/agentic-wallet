import { vi } from "vitest";

/**
 * Minimal fake-fetch helper (no MSW dependency, per minimalism ladder — a
 * one-liner-ish `vi.fn` responder is enough for this test surface). Queue
 * responses in call order; each queued entry becomes one `fetch()` call's
 * resolved Response-like object, and every call is recorded for assertions
 * (e.g. "the request carried the filter param").
 */
export interface QueuedResponse {
  status?: number;
  ok?: boolean;
  body?: unknown;
}

export function installMockFetch(responses: QueuedResponse[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  let index = 0;

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const queued = responses[Math.min(index, responses.length - 1)];
    index += 1;
    const status = queued.status ?? 200;
    return {
      ok: queued.ok ?? (status >= 200 && status < 300),
      status,
      statusText: String(status),
      json: async () => queued.body,
    } as Response;
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}
