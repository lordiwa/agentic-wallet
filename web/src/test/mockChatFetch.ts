import { vi } from "vitest";

/**
 * Minimal fake-fetch helper for testing streamChat's hand-rolled SSE parser
 * (web/src/api/client.ts), mirroring test/mockFetch.ts's no-MSW approach.
 * Unlike mockFetch.ts (queued JSON responses in call order), routes here are
 * matched by predicate because a single test typically mixes plain-JSON
 * calls (GET /api/conversations*) with one streaming POST /api/chat call.
 */
export interface SseEvent {
  event: string;
  data: unknown;
}

function encodeFrame(event: SseEvent): Uint8Array {
  return new TextEncoder().encode(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
}

/**
 * Builds a fake `ReadableStream<Uint8Array>` body that a test drives by
 * calling `push()` for each SSE event and `close()` to end it -- letting
 * tests await a React re-render between events (e.g. to assert a tool
 * status appears, then disappears once the next `text` event lands) instead
 * of racing a stream that resolves all at once.
 */
export function makeControlledSseStream() {
  let controllerRef!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
  });
  return {
    stream,
    push(event: SseEvent) {
      controllerRef.enqueue(encodeFrame(event));
    },
    // Unlike push(), enqueues raw bytes verbatim (no framing added) so a test
    // can control exactly where a `reader.read()` chunk boundary falls --
    // e.g. splitting a frame mid-line, or packing several frames into one
    // push -- to exercise streamChat's buffer-accumulation / multi-frame
    // drain logic instead of always delivering one whole frame per chunk.
    pushRaw(raw: string) {
      controllerRef.enqueue(new TextEncoder().encode(raw));
    },
    close() {
      controllerRef.close();
    },
  };
}

export interface MockRoute {
  match: (url: string, init?: RequestInit) => boolean;
  status?: number;
  ok?: boolean;
  json?: unknown;
  stream?: ReadableStream<Uint8Array>;
}

export function installMockChatFetch(routes: MockRoute[]) {
  const calls: { url: string; init?: RequestInit }[] = [];

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const route = routes.find((r) => r.match(url, init));
    if (!route) throw new Error(`installMockChatFetch: no route matched ${init?.method ?? "GET"} ${url}`);
    const status = route.status ?? 200;
    return {
      ok: route.ok ?? (status >= 200 && status < 300),
      status,
      statusText: String(status),
      json: async () => route.json,
      body: route.stream ?? null,
    } as unknown as Response;
  });

  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}
