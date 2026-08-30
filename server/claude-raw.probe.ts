// Dump crudo de los mensajes del SDK, para ver el error real de auth.
// Carga el .env por la misma via que el motor (process.loadEnvFile).
import { existsSync } from "node:fs";
import { query } from "@anthropic-ai/claude-agent-sdk";

if (existsSync("../.env")) process.loadEnvFile("../.env");

const tok = process.env.CLAUDE_CODE_OAUTH_TOKEN;
console.log("CLAUDE_CODE_OAUTH_TOKEN en process.env:", tok ? `si (len=${tok.length})` : "NO");
console.log("ANTHROPIC_API_KEY:", process.env.ANTHROPIC_API_KEY ? "si" : "no/vacia");
console.log("HOME:", process.env.HOME);

try {
  for await (const m of query({ prompt: "Responde solamente: ok", options: { maxTurns: 1 } })) {
    console.log("MSG", JSON.stringify(m).slice(0, 800));
  }
} catch (e) {
  console.log("THREW:", e instanceof Error ? e.message : String(e));
}
