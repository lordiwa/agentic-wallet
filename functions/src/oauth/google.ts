/**
 * El canje del `code` por tokens contra Google.
 *
 * `fetch` entra por parámetro, no importado: es lo que hace que el test del
 * callback sea un test y no una llamada a producción. En el runtime real se le
 * pasa el `fetch` global de Node 22.
 *
 * Este módulo NO toca Firestore ni sabe de uids. Habla HTTP con Google y
 * devuelve lo que Google dijo.
 */
import { TOKEN_ENDPOINT, REVOKE_ENDPOINT } from "./pkce.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface CanjeParams {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TokensDeGoogle {
  accessToken: string;
  /** Puede faltar: Google sólo lo manda si el consentimiento fue con
   * `access_type=offline` y `prompt=consent`. Si falta, el flujo no sirve —
   * quien llama lo trata como error, no como opcional. */
  refreshToken: string | null;
  expiresInSeconds: number;
  /** Los scopes que el usuario REALMENTE concedió, que pueden ser menos que
   * los pedidos: en la pantalla de Google se pueden destildar. */
  scopes: string[];
  tokenType: string;
}

export class GoogleOAuthError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

/**
 * Canjea el `code` por tokens.
 *
 * El `client_secret` viaja en el body como pide Google para clientes web. **No
 * se loguea nada del body ni de la respuesta**: un `console.log(await
 * res.text())` acá deja el refresh token en Cloud Logging, que es exactamente
 * el lugar donde no queremos que esté (lo lee cualquiera con Viewer en el
 * proyecto, y sobrevive a que borremos el documento de Firestore).
 */
export async function canjearCode(
  params: CanjeParams,
  fetchImpl: FetchLike
): Promise<TokensDeGoogle> {
  const body = new URLSearchParams({
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
    grant_type: "authorization_code",
    code_verifier: params.codeVerifier,
  });

  let res: Response;
  try {
    res = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
  } catch (cause) {
    throw new GoogleOAuthError("red", "no se pudo hablar con el endpoint de tokens de Google");
  }

  if (!res.ok) {
    // El `error` de Google (invalid_grant, redirect_uri_mismatch...) sí se
    // conserva: es un código corto, sin datos de nadie, y sin él un fallo de
    // configuración es indistinguible de un usuario que canceló.
    let codigo = `http_${res.status}`;
    try {
      const detalle = (await res.json()) as { error?: unknown };
      if (typeof detalle.error === "string") codigo = detalle.error;
    } catch {
      // Cuerpo no-JSON: nos quedamos con el status.
    }
    throw new GoogleOAuthError(codigo, "Google rechazó el canje del código");
  }

  const json = (await res.json()) as Record<string, unknown>;
  const accessToken = json.access_token;
  if (typeof accessToken !== "string" || accessToken === "") {
    throw new GoogleOAuthError("respuesta_invalida", "la respuesta de Google no trae access_token");
  }
  const refresh = json.refresh_token;
  const scope = typeof json.scope === "string" ? json.scope : "";
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : 0;

  return {
    accessToken,
    refreshToken: typeof refresh === "string" && refresh !== "" ? refresh : null,
    expiresInSeconds: expiresIn,
    scopes: scope.split(" ").filter((s) => s !== ""),
    tokenType: typeof json.token_type === "string" ? json.token_type : "Bearer",
  };
}

/**
 * De qué cuenta de Gmail es el token que acabamos de recibir.
 *
 * **Por qué se pregunta en vez de asumir el correo de Firebase Auth.** El
 * usuario puede loguearse al wallet con una cuenta y autorizar el Gmail de
 * otra: la pantalla de Google tiene un selector de cuentas y `login_hint` es
 * apenas una sugerencia. Guardar el correo equivocado haría que el panel diga
 * "conectado: ana@ejemplo" mientras la ingesta lee otro buzón — un tipo de
 * confusión que en un producto que lee correo bancario no es aceptable.
 *
 * Se usa el endpoint de `userinfo`, que no necesita scope extra: viene con
 * cualquier token de Google. Devuelve `null` si no se pudo averiguar; el flujo
 * NO se cae por esto, porque el correo es un dato para mostrar, no una llave.
 */
export async function correoDelToken(
  accessToken: string,
  fetchImpl: FetchLike
): Promise<string | null> {
  try {
    const res = await fetchImpl("https://www.googleapis.com/oauth2/v3/userinfo", {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { email?: unknown };
    return typeof json.email === "string" ? json.email : null;
  } catch {
    return null;
  }
}

/**
 * Revoca el permiso en Google. Es la mitad que falta de "desconectar Gmail":
 * borrar el documento de Firestore deja de darnos acceso a nosotros, pero el
 * permiso sigue concedido en la cuenta del usuario hasta que se revoca acá.
 */
export async function revocar(token: string, fetchImpl: FetchLike): Promise<boolean> {
  try {
    const res = await fetchImpl(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    return res.ok;
  } catch {
    return false;
  }
}
