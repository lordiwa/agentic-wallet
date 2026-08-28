import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * Raiz del repo. Normalmente se deduce de la ubicacion de este archivo
 * (`server/src` -> dos niveles arriba), pero el MCP server corre desde un
 * bundle CJS de esbuild y ahi `import.meta` esta vacio: `import.meta.dirname`
 * es `undefined` y `path.resolve` reventaria al cargar el modulo. Por eso el
 * entrypoint bundleado pasa la raiz explicita por env, igual que hace el
 * protocolo MCP con `CLAUDE_PROJECT_DIR`.
 */
export function repoRoot(): string {
  const fromEnv = process.env.WALLET_PROJECT_DIR ?? process.env.CLAUDE_PROJECT_DIR;
  if (typeof fromEnv === "string" && fromEnv.trim() !== "") return path.resolve(fromEnv);
  // En el bundle CJS `import.meta.dirname` es undefined; ahi el cwd es el
  // ultimo recurso razonable (y `.mcp.json` siempre pasa la raiz explicita,
  // asi que este camino es la red de seguridad, no el normal).
  const here: string | undefined = import.meta.dirname;
  return here ? path.resolve(here, "../..") : process.cwd();
}

// Load .env from repo root (Node 22 native, no dotenv dependency needed).
const rootEnvPath = path.join(repoRoot(), ".env");
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
