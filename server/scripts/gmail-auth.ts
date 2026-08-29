/**
 * Autorizacion Gmail de una sola vez (TASK-020, cierre del MEDIUM del review
 * de F1-12): implementa el flujo OAuth2 "Desktop app" + loopback descrito en
 * .claude/skills/claude-agent-sdk-gmail/SKILL.md, seccion 4 -- registra un
 * cliente OAuth2 tipo "Desktop app" en Google Cloud Console, corre este
 * script a mano UNA vez con GMAIL_OAUTH_CLIENT_ID/SECRET ya en `.env`, y
 * copia el refresh_token impreso al final a GMAIL_OAUTH_REFRESH_TOKEN.
 *
 * No forma parte del arranque normal del servidor. El runtime lee el
 * refresh token directamente de `GMAIL_OAUTH_REFRESH_TOKEN` en env (ver
 * sync/build-sync-runner.ts) -- no del `KeyringTokenStore` de
 * ingest/token-store.ts (esa clase existe para el escenario de la skill
 * donde el token vive encriptado en el keychain del SO, pero la
 * implementacion real de F1-08/F1-09 quedo mas simple: env var). Por eso
 * este script solo imprime el token para copiar a mano, en vez de guardarlo
 * via keyring.
 *
 * Corre con `npm run gmail-auth` desde la raiz (o
 * `npm run gmail-auth --workspace=server`).
 */
import crypto from "node:crypto";
import { exec } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";
import { google } from "googleapis";
import { loadConfig } from "../src/config.js";

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
/** Acceso SOLO a los archivos que esta app crea -- no ve el resto del Drive.
 * Se pide con `npm run gmail-auth -- --drive` para poder subir el reporte. */
const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

/**
 * Construccion pura de la consent URL de Google -- separada del resto del
 * flujo (que necesita un servidor loopback real y credenciales validas)
 * para poder testearla sin llamar a Google. Arma la URL a mano en vez de
 * pasar por `OAuth2Client.generateAuthUrl` porque esa API tipa
 * `code_challenge_method` con el enum `CodeChallengeMethod` de
 * `google-auth-library`, que es una dependencia transitiva de `googleapis`
 * (no declarada en package.json) -- construir los query params directamente
 * evita depender de un tipo no declarado, y es el mismo endpoint que esa
 * funcion termina golpeando.
 */
export function buildConsentUrl(params: {
  clientId: string;
  redirectUri: string;
  codeChallenge?: string;
  scopes?: string[];
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    scope: (params.scopes ?? [GMAIL_READONLY_SCOPE]).join(" "),
  });
  if (params.codeChallenge) {
    query.set("code_challenge", params.codeChallenge);
    query.set("code_challenge_method", "S256");
  }
  return `${GOOGLE_AUTH_ENDPOINT}?${query.toString()}`;
}

/** Best-effort: abre la URL en el navegador por defecto. Si falla (SSH, sin
 * entorno grafico), el usuario igual tiene la URL impresa en consola. */
function openInBrowser(url: string): void {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, () => {
    /* no-op: fallo silencioso, la URL ya esta impresa arriba */
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const clientId = config.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = config.GMAIL_OAUTH_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      'Faltan GMAIL_OAUTH_CLIENT_ID / GMAIL_OAUTH_CLIENT_SECRET en .env.\n' +
        'Crea un cliente OAuth2 tipo "Desktop app" en Google Cloud Console y completa ' +
        "ambas variables antes de correr este script (el paso a paso esta en " +
        "docs/conectar-gmail.md)."
    );
    process.exitCode = 1;
    return;
  }

  // PKCE (recomendado por la skill, no estrictamente requerido para clientes
  // Desktop, pero barato y mas seguro).
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

  await new Promise<void>((resolve) => {
    // Puerto 0 = el SO asigna uno libre. Google no exige pre-registrar el
    // puerto para clientes "Desktop app" en el flujo loopback (RFC 8252),
    // solo que el host sea 127.0.0.1 -- asi que esto funciona sin config
    // adicional en la consola de Google Cloud.
    const server = createServer((req, res) => {
      void handleCallback(req, res);
    });

    async function handleCallback(req: IncomingMessage, res: ServerResponse) {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/oauth2callback") {
        res.writeHead(404).end();
        return;
      }

      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");

      if (error || !code) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Autorizacion fallida. Puedes cerrar esta pestana.");
        console.error(`Autorizacion cancelada o fallida${error ? `: ${error}` : " (falta ?code= en el callback)"}.`);
        process.exitCode = 1;
        server.close(() => resolve());
        return;
      }

      try {
        const port = (server.address() as { port: number }).port;
        const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
        const { tokens } = await oauth2Client.getToken({ code, codeVerifier: verifier });

        if (!tokens.refresh_token) {
          res
            .writeHead(200, { "Content-Type": "text/plain; charset=utf-8" })
            .end("Autorizado, pero Google no devolvio un refresh_token. Revisa la consola.");
          console.error(
            "Google no devolvio refresh_token (suele pasar si ya autorizaste este cliente antes " +
              "y el consentimiento no se re-pidio). Revoca el acceso en " +
              "https://myaccount.google.com/permissions y vuelve a correr este script."
          );
          process.exitCode = 1;
        } else {
          res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("Autorizado. Puedes cerrar esta pestana.");
          console.log("\nAutorizacion exitosa. Copia este valor a GMAIL_OAUTH_REFRESH_TOKEN en .env:\n");
          console.log(tokens.refresh_token);
          console.log("");
        }
      } catch (err) {
        res
          .writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
          .end("Error intercambiando el codigo por tokens. Revisa la consola.");
        console.error(`Error intercambiando el codigo por tokens: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      } finally {
        server.close(() => resolve());
      }
    }

    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
      // `--drive` suma el permiso para subir el reporte a Drive. Sin la
      // bandera el flujo queda exactamente como estaba: solo lectura de Gmail.
      const scopes = process.argv.includes("--drive")
        ? [GMAIL_READONLY_SCOPE, DRIVE_FILE_SCOPE]
        : [GMAIL_READONLY_SCOPE];
      const consentUrl = buildConsentUrl({ clientId, redirectUri, codeChallenge: challenge, scopes });
      console.log(`Permisos que se van a pedir:\n  ${scopes.join("\n  ")}\n`);

      console.log("Abri esta URL y autoriza el acceso de solo lectura a Gmail:\n");
      console.log(consentUrl);
      console.log("");
      openInBrowser(consentUrl);
    });
  });
}

// Solo corre al invocarse directamente (`tsx scripts/gmail-auth.ts`), no al
// importarse -- mismo guard que index.ts/seed/cli.ts, para que
// gmail-auth.test.ts pueda importar `buildConsentUrl` sin disparar el flujo
// OAuth real (que abriria un servidor loopback y llamaria a loadConfig())
// como efecto secundario del import.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`Error inesperado: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
