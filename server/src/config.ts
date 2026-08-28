import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// Load .env from repo root (Node 22 native, no dotenv dependency needed).
const rootEnvPath = path.resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnvPath)) {
  process.loadEnvFile(rootEnvPath);
}

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  /**
   * Interfaz donde escucha el server. El default es 127.0.0.1 A PROPOSITO:
   * `app.listen(port)` sin host escucha en 0.0.0.0, lo que en una VPS con IP
   * publica deja la API abierta a internet. La API no tiene ninguna
   * autenticacion (ver docs/handoff-migracion-server.md), asi que exponerla
   * equivale a publicar el historial bancario, el Gmail via POST /api/sync y
   * el credito de Claude via POST /api/chat.
   *
   * En la VPS se deja en 127.0.0.1 y el acceso remoto se da con
   * `tailscale serve`, que proxea desde el tailnet hacia localhost sin abrir
   * ningun puerto publico. Ponerlo en 0.0.0.0 es una decision explicita, no
   * un accidente de configuracion.
   */
  WALLET_BIND_HOST: z.string().default("127.0.0.1"),
  WALLET_DB_PATH: z.string().default("./wallet.sqlite"),
  ANTHROPIC_API_KEY: z.string().optional(),
  CLAUDE_CODE_OAUTH_TOKEN: z.string().optional(),
  GMAIL_OAUTH_CLIENT_ID: z.string().optional(),
  GMAIL_OAUTH_CLIENT_SECRET: z.string().optional(),
  GMAIL_OAUTH_REFRESH_TOKEN: z.string().optional(),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(): Config {
  return envSchema.parse(process.env);
}
