/**
 * Clasifica la credencial de Claude que hay en el entorno.
 *
 * Existe por un modo de falla real, encontrado corriendo el onboarding con
 * credenciales de verdad (ver docs/reliability.md, item 2): en `.env` habia un
 * token de 108 caracteres que empezaba con `sk-ant-ort01`. Es el **refresh
 * token** que vive en `~/.claude/.credentials.json`, no el token que emite
 * `claude setup-token` (`sk-ant-oat01`). Los dos tienen el mismo largo y el
 * mismo aspecto, y estan a dos lineas de distancia en ese archivo, asi que
 * confundirlos es lo esperable, no lo raro.
 *
 * Con el chequeo viejo —"la variable tiene algo adentro"— esa confusion pasaba
 * completamente inadvertida: `--status` decia `claude: done`, el sync
 * arrancaba, y la API devolvia 401 en cada correo. Como una extraccion fallida
 * es indistinguible de "Claude no encontro el monto", el resultado era el peor
 * posible: el buzon entero entrando al ledger con `amount: null` y
 * `needs_review: true`, sin que nada dijera "tu credencial esta mal".
 *
 * Por eso el chequeo mira el prefijo. No valida que el token sirva —eso solo lo
 * dice la API— pero descarta las equivocaciones que sí se pueden ver desde
 * aca, que son justo las que un humano comete al copiar y pegar.
 */

/** Token de suscripcion Pro/Max que imprime `claude setup-token`. */
const OAUTH_TOKEN_PREFIX = "sk-ant-oat";
/** API key medida de la consola de Anthropic. */
const API_KEY_PREFIX = "sk-ant-api";
/** Refresh token de `~/.claude/.credentials.json` — la confusion documentada. */
const REFRESH_TOKEN_PREFIX = "sk-ant-ort";

export type ClaudeCredentialKind = "oauth-token" | "api-key" | "missing" | "malformed";

/**
 * Lo unico que la funcion necesita leer. Se pide esta forma —y no
 * `NodeJS.ProcessEnv`— para que los dos origenes de credencial del proyecto
 * entren sin adaptador: el entorno crudo (`process.env`, en el onboarding) y
 * el `Config` ya parseado por zod (en el server y el sync runner).
 */
export interface ClaudeCredentialEnv {
  ANTHROPIC_API_KEY?: string | undefined;
  CLAUDE_CODE_OAUTH_TOKEN?: string | undefined;
}

export interface ClaudeCredential {
  kind: ClaudeCredentialKind;
  /** Cual de las dos variables se uso, o null si no habia ninguna. */
  source: "ANTHROPIC_API_KEY" | "CLAUDE_CODE_OAUTH_TOKEN" | null;
  /** Utilizable = hay credencial y tiene la forma correcta. */
  usable: boolean;
  /** Que hacer, en castellano. Vacio cuando `usable` es true. */
  problem: string;
}

function trimmed(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * `ANTHROPIC_API_KEY` primero: es la precedencia que la doc afirmaba sin que
 * el codigo la implementara (las dos variables se trataban como un OR
 * simetrico). Ahora el orden es explicito y esta cubierto por tests.
 */
export function classifyClaudeCredential(env: ClaudeCredentialEnv): ClaudeCredential {
  const apiKey = trimmed(env.ANTHROPIC_API_KEY);
  const oauthToken = trimmed(env.CLAUDE_CODE_OAUTH_TOKEN);

  if (apiKey !== "") {
    if (apiKey.startsWith(API_KEY_PREFIX)) {
      return { kind: "api-key", source: "ANTHROPIC_API_KEY", usable: true, problem: "" };
    }
    return {
      kind: "malformed",
      source: "ANTHROPIC_API_KEY",
      usable: false,
      problem: describe(apiKey, "ANTHROPIC_API_KEY", API_KEY_PREFIX),
    };
  }

  if (oauthToken !== "") {
    if (oauthToken.startsWith(OAUTH_TOKEN_PREFIX)) {
      return { kind: "oauth-token", source: "CLAUDE_CODE_OAUTH_TOKEN", usable: true, problem: "" };
    }
    return {
      kind: "malformed",
      source: "CLAUDE_CODE_OAUTH_TOKEN",
      usable: false,
      problem: describe(oauthToken, "CLAUDE_CODE_OAUTH_TOKEN", OAUTH_TOKEN_PREFIX),
    };
  }

  return { kind: "missing", source: null, usable: false, problem: "" };
}

/** El mensaje nunca incluye el valor: solo el prefijo que lo delata. */
function describe(value: string, variable: string, expectedPrefix: string): string {
  if (value.startsWith(REFRESH_TOKEN_PREFIX)) {
    return (
      `${variable} tiene un refresh token (empieza con ${REFRESH_TOKEN_PREFIX}...), no un token de acceso. ` +
      `Es el valor "refreshToken" de ~/.claude/.credentials.json; el que hace falta lo imprime ` +
      "`claude setup-token` y empieza con " +
      `${expectedPrefix}...`
    );
  }
  if (variable === "ANTHROPIC_API_KEY" && value.startsWith(OAUTH_TOKEN_PREFIX)) {
    return (
      `ANTHROPIC_API_KEY tiene un token de suscripcion (${OAUTH_TOKEN_PREFIX}...). ` +
      "Ese valor va en CLAUDE_CODE_OAUTH_TOKEN; ANTHROPIC_API_KEY espera una API key " +
      `${API_KEY_PREFIX}... de la consola de Anthropic.`
    );
  }
  if (variable === "CLAUDE_CODE_OAUTH_TOKEN" && value.startsWith(API_KEY_PREFIX)) {
    return (
      `CLAUDE_CODE_OAUTH_TOKEN tiene una API key (${API_KEY_PREFIX}...). ` +
      "Ese valor va en ANTHROPIC_API_KEY; CLAUDE_CODE_OAUTH_TOKEN espera el token que imprime " +
      "`claude setup-token`."
    );
  }
  return `${variable} no tiene la forma esperada: deberia empezar con ${expectedPrefix}...`;
}
