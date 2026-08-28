/**
 * Minimal, dependency-free span + structured-log helper (see
 * .claude/shared/OBSERVABILITY.md: every functionality gets a trace span +
 * a correlated structured log; a metric on key paths — Gmail/Claude are
 * exactly that: external integrations).
 *
 * No OpenTelemetry SDK (tracer provider/exporter) is wired anywhere in this
 * project yet — no other ticket's code imports `@opentelemetry/*` or sets
 * one up, and doing so is a cross-cutting, project-wide decision outside
 * this ticket's file boundary (server/src/ingest/ + server/package.json
 * only; index.ts/config.ts, where a real provider would be bootstrapped,
 * are off-limits here). `withSpan` gives every ingest operation the same
 * trace_id/span_id-correlated start/success/error structured-log shape a
 * real OTel span would, so wiring a real SDK later is a drop-in
 * replacement of this module's internals, not a call-site rewrite.
 * Never logs email content, amounts, or counterparty names — only ids and
 * counts (see OBSERVABILITY.md's "no PII/secrets in attributes/logs").
 */
import { randomUUID } from "node:crypto";

export interface SpanContext {
  trace_id: string;
  span_id: string;
}

function emit(level: "info" | "error", event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

/**
 * Runs `fn` inside a span named `name` (the operation, e.g. "ingest.run" —
 * not the function name), logging a correlated start/success/error line.
 * On error: logs with the exception message (record_exception-equivalent)
 * and error status, then rethrows — never swallows the failure.
 */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, unknown>,
  fn: (span: SpanContext) => Promise<T>
): Promise<T> {
  const span: SpanContext = { trace_id: randomUUID(), span_id: randomUUID() };
  const startedAt = Date.now();
  emit("info", `${name}.start`, { ...span, ...attributes });
  try {
    const result = await fn(span);
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

/** A metric-shaped structured log line for a key path's outcome counts (not
 * a real OTel counter/histogram — see the module doc's SDK caveat). */
export function emitMetric(name: string, attributes: Record<string, unknown>): void {
  emit("info", `metric.${name}`, attributes);
}
