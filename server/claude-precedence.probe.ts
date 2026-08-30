// ¿Gana ANTHROPIC_API_KEY sobre CLAUDE_CODE_OAUTH_TOKEN? El .env lo afirma.
// Token OAuth valido + API key basura: si falla/reintenta 401, la API key tiene precedencia.
import { query } from "@anthropic-ai/claude-agent-sdk";

process.env.CLAUDE_CODE_OAUTH_TOKEN = process.env.PROBE_TOKEN!;
process.env.ANTHROPIC_API_KEY = "sk-ant-api03-BASURA-INVALIDA";

try {
  for await (const m of query({ prompt: "Responde solamente: ok", options: { maxTurns: 1 } })) {
    if (m.type === "system" && (m as { subtype?: string }).subtype === "api_retry") {
      console.log("api_retry status=", (m as { error_status?: number }).error_status);
    }
    if (m.type === "result") console.log("RESULT subtype=", m.subtype, "is_error=", (m as { is_error?: boolean }).is_error, JSON.stringify((m as { result?: string }).result));
  }
} catch (e) {
  console.log("THREW:", e instanceof Error ? e.message : String(e));
}
