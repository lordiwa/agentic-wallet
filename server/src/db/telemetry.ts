/**
 * Minimal, dependency-free *synchronous* span + structured-log helper for
 * server/src/seed/ and server/src/db/ (see OBSERVABILITY.md: every
 * functionality gets a trace span + a correlated structured log; a metric on
 * key paths). Mirrors the shape of server/src/ingest/telemetry.ts's
 * `withSpan`/`emitMetric` (start/success/error lines correlated by
 * trace_id/span_id), but synchronous because better-sqlite3 calls (seeding,
 * strategy_config reads) never await anything -- an async wrapper here would
 * just be dead ceremony around a sync call. No OpenTelemetry SDK is wired
 * anywhere in this project yet (see ingest/telemetry.ts's caveat); this is a
 * drop-in-replaceable stand-in with the same log shape.
 *
 * Never logs personal values (debt person names, strategy_config's titular
 * or sueldo, balance amounts) -- only ids, keys, and counts.
 */
import { randomUUID } from "node:crypto";

export interface SpanContext {
  trace_id: string;
  span_id: string;
}

/**
 * Suppresses the `info` span lines when set (see `WALLET_TELEMETRY_SILENT`).
 *
 * This exists for the CLIs, whose stdout is a *result*, not a log: an agent
 * driving `npm run onboard -- --suggest` parses that stdout as JSON, and
 * interleaved span lines make it unparseable. `error` lines are never
 * silenced -- a failure must stay visible on stderr no matter who is
 * listening -- and stderr is a separate stream, so it cannot corrupt the
 * result either way.
 */
function silenced(): boolean {
  const raw = process.env.WALLET_TELEMETRY_SILENT;
  return raw === "1" || raw === "true";
}

function emit(level: "info" | "error", event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === "error") console.error(line);
  else if (!silenced()) console.log(line);
}

/**
 * Runs `fn` inside a span named `name` (the operation, e.g. "seed.run" --
 * not the function name), logging a correlated start/success/error line. On
 * error: logs the exception message (record_exception-equivalent) and error
 * status, then rethrows -- never swallows the failure.
 */
export function withSpanSync<T>(name: string, attributes: Record<string, unknown>, fn: (span: SpanContext) => T): T {
  const span: SpanContext = { trace_id: randomUUID(), span_id: randomUUID() };
  const startedAt = Date.now();
  emit("info", `${name}.start`, { ...span, ...attributes });
  try {
    const result = fn(span);
    emit("info", `${name}.success`, { ...span, duration_ms: Date.now() - startedAt });
    return result;
  } catch (error) {
    emit("error", `${name}.error`, {
      ...span,
      duration_ms: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * A standalone structured `info` line, for facts that aren't a span or a
 * metric (e.g. "these config keys fell back to defaults"). Goes through the
 * same `emit` as spans, so `WALLET_TELEMETRY_SILENT` covers it too -- a
 * direct `console.log` here would leak into a CLI's JSON result.
 */
export function logInfo(event: string, fields: Record<string, unknown>): void {
  emit("info", event, fields);
}

/** A metric-shaped structured log line for a key path's outcome counts (not a real OTel counter/histogram). */
export function emitMetric(name: string, attributes: Record<string, unknown>): void {
  emit("info", `metric.${name}`, attributes);
}
