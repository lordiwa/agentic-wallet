// Verifica si el SDK autentica leyendo CLAUDE_CODE_OAUTH_TOKEN de process.env,
// con HOME limpio (sin ~/.claude/.credentials.json ambiente).
// El token entra por PROBE_TOKEN para que loadEnvFile no lo pise.
import { query } from "@anthropic-ai/claude-agent-sdk";

const probeToken = process.env.PROBE_TOKEN;
if (!probeToken) throw new Error("falta PROBE_TOKEN");
process.env.CLAUDE_CODE_OAUTH_TOKEN = probeToken;
delete process.env.ANTHROPIC_API_KEY;

console.log("HOME:", process.env.HOME);
console.log("token inyectado: len=", probeToken.length, "tipo=", probeToken.split("-").slice(0, 3).join("-"));

try {
  for await (const m of query({ prompt: "Responde solamente la palabra: ok", options: { maxTurns: 1 } })) {
    if (m.type === "result") {
      console.log("RESULT subtype=", m.subtype, "is_error=", (m as { is_error?: boolean }).is_error);
      console.log("result text=", JSON.stringify((m as { result?: string }).result));
    }
    if (m.type === "system" && (m as { subtype?: string }).subtype === "api_retry") {
      console.log("api_retry status=", (m as { error_status?: number }).error_status);
    }
  }
} catch (e) {
  console.log("THREW:", e instanceof Error ? e.message : String(e));
}
