/**
 * El único lugar que sabe dónde vive el ledger de un tenant.
 *
 * Todas las rutas cuelgan de `users/{uid}`: **el aislamiento entre tenants es
 * la forma del árbol, no un `WHERE`**. Una consulta mal escrita en SQL
 * multi-tenant devuelve las filas de otro; acá una consulta mal escrita no
 * tiene de dónde sacarlas, porque la colección que se consulta ya está debajo
 * de un uid. Esa es la razón de que las colecciones sean subcolecciones y no
 * colecciones raíz con un campo `uid`.
 *
 * El `uid` que entra acá viene SIEMPRE de `decodedToken.uid` — nunca de la
 * query, el body o un header. Ver `auth/verify.ts`.
 */
import type { Firestore } from "firebase-admin/firestore";

/** Rechaza un uid que no pueda ser un segmento de path de Firestore. */
export function assertUid(uid: string): string {
  if (typeof uid !== "string" || uid.length === 0 || uid.length > 128) {
    throw new Error("uid invalido");
  }
  // "/" partiría el path; "." y ".." son segmentos reservados de Firestore;
  // "__x__" es el prefijo reservado del sistema.
  if (uid.includes("/") || uid === "." || uid === ".." || /^__.*__$/.test(uid)) {
    throw new Error("uid invalido");
  }
  return uid;
}

export function userDoc(db: Firestore, uid: string) {
  return db.collection("users").doc(assertUid(uid));
}

export function transactions(db: Firestore, uid: string) {
  return userDoc(db, uid).collection("transactions");
}

export function rules(db: Firestore, uid: string) {
  return userDoc(db, uid).collection("rules");
}

export function silenced(db: Firestore, uid: string) {
  return userDoc(db, uid).collection("silenced");
}

export function statements(db: Firestore, uid: string) {
  return userDoc(db, uid).collection("statements");
}

export function savings(db: Firestore, uid: string) {
  return userDoc(db, uid).collection("savings");
}

export function debts(db: Firestore, uid: string) {
  return userDoc(db, uid).collection("debts");
}

export function reviews(db: Firestore, uid: string) {
  return userDoc(db, uid).collection("reviews");
}

export function counterparties(db: Firestore, uid: string) {
  return userDoc(db, uid).collection("counterparties");
}

export function metering(db: Firestore, uid: string) {
  return userDoc(db, uid).collection("metering");
}

/**
 * `config` es una colección con documentos de nombre FIJO, no campos de
 * `users/{uid}`. Es para poder darle a cada uno su propia regla de seguridad:
 * `config/strategy` lo lee el cliente, `config/gmail` —donde vive el refresh
 * token cifrado— no lo lee nadie desde el navegador. Con todo en el mismo
 * documento, una regla que permita leer el perfil filtra el token.
 */
export const CONFIG_DOCS = {
  strategy: "strategy",
  sync: "sync",
  gmail: "gmail",
} as const;

export function configDoc(db: Firestore, uid: string, name: keyof typeof CONFIG_DOCS) {
  return userDoc(db, uid).collection("config").doc(CONFIG_DOCS[name]);
}

/**
 * Un id de documento de Firestore no puede contener "/", ni ser "." o "..", ni
 * pasar de 1500 bytes. Un patrón normalizado es texto libre del banco: casi
 * siempre inofensivo, pero "casi" no alcanza para una clave primaria.
 *
 * Se codifica sólo lo prohibido y se deja el resto legible, para que un humano
 * pueda mirar la consola de Firestore y reconocer la regla.
 *
 * Vive **acá** y no en `scripts/migrate-tenant.ts`, que es donde nació: el
 * `firebase.json` excluye `scripts/` del deploy, así que un escritor de reglas
 * en runtime (`POST /classify`, `POST /classify/silence`) que la importara de
 * allá compilaría en local y no existiría en producción. `migrate-tenant.ts` la
 * reexporta desde acá para no tener dos.
 */
export function encodeDocId(raw: string): string {
  const safe = raw.replace(/\//g, "%2F");
  // `encodeURIComponent(".")` devuelve "." — el punto es un caracter no
  // reservado de URI. La sustitucion tiene que ser explicita.
  if (safe === ".") return "%2E";
  if (safe === "..") return "%2E%2E";
  if (/^__.*__$/.test(safe)) return `x${safe}`;
  const bytes = Buffer.from(safe, "utf8");
  return bytes.length <= 1500 ? safe : bytes.subarray(0, 1500).toString("utf8");
}
