/**
 * El documento `users/{uid}/config/gmail`: lo único que sabe dónde está el
 * refresh token de una persona.
 *
 * **Regla de oro de este archivo: `leerRefreshToken` NO se llama desde ninguna
 * ruta HTTP que le conteste al navegador.** El token lo lee la ingesta y nadie
 * más. Lo que el panel puede pedir es `leerEstado`, que devuelve metadatos
 * —conectado sí/no, qué correo, cuándo, qué scopes— y jamás el blob. Están en
 * el mismo módulo para que la diferencia se vea de un vistazo al importar.
 */
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { configDoc } from "../ledger/paths.js";
import { decrypt, encrypt, type EncryptedBlob, type MasterKey } from "./crypto.js";

/** Lo que se guarda. El blob cifrado va anidado en `refreshToken` para que sea
 * imposible confundirlo con un string. */
export interface GmailConfigDoc {
  conectado: boolean;
  refreshToken: EncryptedBlob;
  /** La cuenta de Gmail que se autorizó — no necesariamente la de Firebase
   * Auth. Ver `correoDelToken` en `google.ts`. */
  email: string | null;
  scopes: string[];
  grantedAt: Timestamp;
  updatedAt: Timestamp;
  /** Cuándo falló el último refresh, si falló. Es lo que le deja al panel
   * decir "hay que reconectar" en vez de mostrar una ingesta vacía. */
  invalidSince: Timestamp | null;
  motivoInvalido: string | null;
}

/** Lo que el panel puede ver. Sin blob, sin bytes, sin nada que se parezca a
 * un token. */
export interface EstadoGmail {
  conectado: boolean;
  email: string | null;
  scopes: string[];
  grantedAt: string | null;
  necesitaReconectar: boolean;
}

export const DESCONECTADO: EstadoGmail = {
  conectado: false,
  email: null,
  scopes: [],
  grantedAt: null,
  necesitaReconectar: false,
};

export interface GuardarTokenOpts {
  db: Firestore;
  uid: string;
  refreshToken: string;
  email: string | null;
  scopes: readonly string[];
  master: MasterKey;
  ahora?: Date;
}

/**
 * Guarda el refresh token cifrado. El AAD es el uid: un blob copiado al
 * documento de otro tenant no descifra.
 *
 * `set` sin merge a propósito: reconectar Gmail reemplaza el documento entero,
 * incluida cualquier marca de "inválido" de la conexión anterior. Un merge
 * dejaría un `invalidSince` viejo sobre un token nuevo y bueno.
 */
export async function guardarRefreshToken(opts: GuardarTokenOpts): Promise<void> {
  const ahora = Timestamp.fromDate(opts.ahora ?? new Date());
  const doc: GmailConfigDoc = {
    conectado: true,
    refreshToken: encrypt(opts.refreshToken, opts.uid, opts.master),
    email: opts.email,
    scopes: [...opts.scopes],
    grantedAt: ahora,
    updatedAt: ahora,
    invalidSince: null,
    motivoInvalido: null,
  };
  await configDoc(opts.db, opts.uid, "gmail").set(doc);
}

/**
 * Devuelve el refresh token en claro. **Sólo para la ingesta.** Si esta función
 * aparece importada en `api/`, es un bug de seguridad.
 */
export async function leerRefreshToken(
  db: Firestore,
  uid: string,
  claves: readonly MasterKey[]
): Promise<string | null> {
  const snap = await configDoc(db, uid, "gmail").get();
  if (!snap.exists) return null;
  const doc = snap.data() as Partial<GmailConfigDoc>;
  if (doc.conectado !== true || doc.refreshToken === undefined) return null;
  return decrypt(doc.refreshToken, uid, claves);
}

/** Metadatos para el panel. Nunca descifra nada: no le hace falta. */
export async function leerEstado(db: Firestore, uid: string): Promise<EstadoGmail> {
  const snap = await configDoc(db, uid, "gmail").get();
  if (!snap.exists) return DESCONECTADO;
  const doc = snap.data() as Partial<GmailConfigDoc>;
  if (doc.conectado !== true) return DESCONECTADO;
  return {
    conectado: true,
    email: doc.email ?? null,
    scopes: doc.scopes ?? [],
    grantedAt: doc.grantedAt?.toDate().toISOString() ?? null,
    // Un token que Google ya rechazó sigue "conectado" en el documento pero no
    // sirve. El panel necesita distinguirlo: "reconectá" es una acción, "no
    // conectaste nunca" es otra pantalla.
    necesitaReconectar: doc.invalidSince != null,
  };
}

/**
 * Marca la conexión como inválida (Google devolvió `invalid_grant`: el usuario
 * revocó, cambió la contraseña, o el token de una app en modo *testing* cumplió
 * sus 7 días — ver §1.6 del diseño).
 *
 * **No borra el blob.** Borrarlo perdería el `keyVersion` y el `grantedAt`, que
 * es lo que permite después decir desde cuándo está roto y con qué clave estaba
 * cifrado. Lo que se pierde es la utilidad, no el rastro.
 */
export async function marcarInvalido(
  db: Firestore,
  uid: string,
  motivo: string,
  ahora: Date = new Date()
): Promise<void> {
  await configDoc(db, uid, "gmail").set(
    {
      conectado: false,
      invalidSince: Timestamp.fromDate(ahora),
      motivoInvalido: motivo,
      updatedAt: Timestamp.fromDate(ahora),
    },
    { merge: true }
  );
}

/** Borra la conexión. La revocación en Google va aparte (`google.ts`): esto
 * sólo saca el token de nuestra base. */
export async function olvidarConexion(db: Firestore, uid: string): Promise<void> {
  await configDoc(db, uid, "gmail").set(
    {
      conectado: false,
      refreshToken: FieldValue.delete(),
      email: null,
      scopes: [],
      updatedAt: Timestamp.fromDate(new Date()),
    },
    { merge: true }
  );
}
