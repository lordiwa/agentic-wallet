/**
 * La verificación del ID token: el único punto donde se decide de quién es el
 * ledger que se va a leer.
 *
 * **El tenant lo decide el token, jamás el cliente.** No hay ruta que acepte un
 * uid en la query, el body o un header — el uid sale de `verifyIdToken()` y de
 * ningún otro lado. Las reglas de Firestore son la segunda cerradura, no la
 * primera: una Cloud Function corre con credenciales de administrador y las
 * reglas NO se le aplican, así que si esta capa se equivoca de uid, Firestore
 * la obedece sin chistar.
 *
 * `checkRevoked: true` a propósito, y con su costo declarado: agrega una
 * lectura al backend de Auth en cada petición, pero es lo que hace que
 * "revoqué la sesión de ese usuario" signifique algo antes de que expire el
 * token (hasta una hora). Para un producto que lee correo bancario, una hora
 * de sesión zombi es demasiado.
 */
import type { Auth, DecodedIdToken } from "firebase-admin/auth";
import type { Request } from "firebase-functions/v2/https";

export class AuthError extends Error {
  constructor(
    readonly status: 401 | 403,
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Extrae el token de `Authorization: Bearer <token>`. Case-insensitive en el
 * esquema porque el RFC lo es, estricto en lo demás. */
export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer[ ]+(\S+)$/i.exec(header.trim());
  return match ? match[1]! : null;
}

export interface AuthenticatedUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

/**
 * Verifica el ID token de la petición y devuelve el usuario.
 *
 * `email_verified` se exige porque en el piloto los usuarios son cuentas del
 * Workspace propio: un correo sin verificar no debería existir, y si aparece
 * uno es una señal, no un caso normal a tolerar.
 */
export async function authenticate(auth: Auth, req: Request): Promise<AuthenticatedUser> {
  const token = bearerToken(req.headers.authorization);
  if (token === null) {
    throw new AuthError(401, "sin_token", "falta el header Authorization: Bearer <ID token>");
  }

  let decoded: DecodedIdToken;
  try {
    decoded = await auth.verifyIdToken(token, true);
  } catch {
    // Nunca se propaga el mensaje del SDK: distingue "token expirado" de
    // "firma invalida" de "proyecto equivocado", y eso es informacion que le
    // sirve a quien esta probando tokens, no al usuario legitimo.
    throw new AuthError(401, "token_invalido", "el ID token no es valido");
  }

  if (decoded.email_verified === false) {
    throw new AuthError(403, "correo_sin_verificar", "la cuenta no tiene el correo verificado");
  }

  return {
    uid: decoded.uid,
    email: typeof decoded.email === "string" ? decoded.email : null,
    emailVerified: decoded.email_verified === true,
  };
}
