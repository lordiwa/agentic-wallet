/**
 * La lista blanca de backends, del lado del cliente (R1/R2, fase N0).
 *
 * El problema que resuelve no es teorico. El panel resuelve a que server
 * hablarle desde la URL (`?api=`), y con `WALLET_ACCESS_TOKEN` la llave viaja
 * en la cabecera de cada llamada. Un enlace `?api=https://host-ajeno` que se
 * guardara solo convertiria al panel en un mensajero: la proxima llamada le
 * entrega la llave del ledger a quien mando el enlace. Por eso hay dos
 * decisiones separadas, y ninguna es automatica:
 *
 *   1. **A que backend le hablo** — se puede cambiar, pero se guarda solo con
 *      confirmacion explicita (ver api/base.ts).
 *   2. **A que backend le doy la llave** — solo a los de esta lista. Un
 *      backend fuera de ella se llama IGUAL, pero **sin credencial**: el
 *      panel prefiere un 401 que se explica ("ese servidor no esta
 *      autorizado") antes que un 200 conseguido regalando la llave.
 *
 * Este modulo es puro a proposito: no toca `window`, `localStorage` ni
 * `import.meta.env`. Todo eso lo inyecta el llamador, y asi la politica se
 * testea sin navegador.
 */

/** Base "magica" que no habla con ningun server: sirve datos de demostracion. */
export const DEMO_BASE = "demo";

export type OriginVerdict =
  /** `""` — el server que sirve el panel. Es su propio origen. */
  | "same-origin"
  /** `demo` — no hay red, no hay a quien darle nada. */
  | "demo"
  /** `localhost` / `127.0.0.0/8` / `::1` — la maquina de quien mira. */
  | "loopback"
  /** Vino en la lista del build (`VITE_WALLET_TRUSTED_API_ORIGINS`). */
  | "configured"
  /** Lo confirmo el usuario en este navegador, a mano. */
  | "trusted"
  /**
   * El usuario dijo que **no**: guardo este backend con "sin darle la llave".
   * Gana sobre cualquier otro veredicto, incluido `loopback` (wargaming ronda
   * 3, W27) — si no, ese boton seria un no-op para todo lo que entra solo, que
   * es exactamente lo que era.
   */
  | "denied"
  /** Cualquier otro. Se le habla sin credencial. */
  | "foreign";

/** Sin barra final ni espacios: los paths ya empiezan con "/". */
export function normalizeBase(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/+$/, "");
}

/**
 * El origen (`https://host:puerto`) de una base. `null` si la base no es una
 * URL absoluta parseable — y eso incluye una relativa como `/api`, que no
 * tiene origen propio porque hereda el del documento.
 */
export function originOf(base: string): string | null {
  const value = normalizeBase(base);
  if (value === "" || value === DEMO_BASE) return null;
  try {
    const url = new URL(value);
    // Solo http(s): un `javascript:` o un `data:` no son backends, y
    // `new URL` los acepta feliz.
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * La maquina de quien mira. Darle la llave a tu propio equipo no la expone
 * a nadie mas, asi que el loopback entra sin configurar nada.
 *
 * **`*.localhost` NO entra** (wargaming ronda 3, W13b). La ronda 2 lo aceptó
 * como limitacion apoyada en RFC 6761 y en que "Chrome y Firefox resuelven
 * `*.localhost` a loopback". Las dos mitades de esa justificacion se caen al
 * mirarlas: la RFC dice **SHOULD**, no MUST (y el draft que lo volvia
 * obligatorio expiro sin llegar a RFC), y WebKit declara explicitamente que en
 * plataformas Apple el resolver del sistema **no garantiza** que `localhost`
 * mapee a loopback (bug 171934, abierto). W3C Secure Contexts condiciona la
 * confianza a que el navegador cumpla ese draft y advierte que los resolvers
 * "a menudo ignoran estas sugerencias".
 *
 * Con un sufijo de busqueda DNS, `ajeno.localhost` puede resolver a una IP
 * publica — y ese origen recibia la llave sin que el usuario autorizara nada,
 * porque `loopback` entra solo. Nadie hospeda su billetera en
 * `panel.localhost`, asi que la rama se va: quien la necesite la autoriza a
 * mano como cualquier otro backend.
 */
export function isLoopbackOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost") return true;
  if (host === "::1" || host === "[::1]") return true;
  // 127.0.0.0/8 entero, no solo 127.0.0.1.
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** Coma-separada, tolerante a espacios y a la barra final que arrastra un
 * copiar/pegar. Mismo criterio que `parseAllowedOrigins` del server. */
export function parseTrustedOrigins(raw: string | null | undefined): string[] {
  if (typeof raw !== "string") return [];
  const out: string[] = [];
  for (const piece of raw.split(",")) {
    const origin = originOf(piece);
    // El comodin se descarta: una lista blanca con `*` no es una lista blanca.
    if (origin !== null && !out.includes(origin)) out.push(origin);
  }
  return out;
}

export interface TrustPolicy {
  /** Origenes fijados en el build (`VITE_WALLET_TRUSTED_API_ORIGINS`). */
  configured?: readonly string[];
  /** Origenes que el usuario confirmo a mano en este navegador. */
  trusted?: readonly string[];
  /** Origenes que el usuario guardo **negandoles** la llave. Ver `denied`. */
  denied?: readonly string[];
}

export function classifyBackend(base: string, policy: TrustPolicy = {}): OriginVerdict {
  const value = normalizeBase(base);
  if (value === "") return "same-origin";
  if (value === DEMO_BASE) return "demo";

  const origin = originOf(value);
  if (origin === null) return "foreign";
  // La negacion explicita va PRIMERO: es la unica forma de que "guardar sin
  // darle la llave" signifique algo para un backend que entraria solo (W27).
  if ((policy.denied ?? []).includes(origin)) return "denied";
  if (isLoopbackOrigin(origin)) return "loopback";
  if ((policy.configured ?? []).includes(origin)) return "configured";
  if ((policy.trusted ?? []).includes(origin)) return "trusted";
  return "foreign";
}

/** El unico lugar donde se decide si la llave sale del navegador. */
export function mayReceiveCredential(verdict: OriginVerdict): boolean {
  return verdict === "same-origin" || verdict === "loopback" || verdict === "configured" || verdict === "trusted";
}
