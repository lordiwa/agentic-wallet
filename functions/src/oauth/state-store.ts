/**
 * El `state` del OAuth: dónde vive entre que el panel arma la URL y Google
 * vuelve al callback.
 *
 * **Por qué Firestore y no un JWT firmado** (que es lo que proponía
 * `docs/pivot-firebase.md` §1.6). Un JWT firmado resuelve dos de las tres
 * propiedades que hacen falta —que lo hayamos emitido nosotros, y que sea
 * reciente— pero no la tercera: **un solo uso**. Un JWT es válido tantas veces
 * como lo presenten hasta que expire, y un `state` reusable convierte cualquier
 * filtración de la URL de callback (historial, referer, un log de proxy) en un
 * replay. Para que un JWT sea de un solo uso hay que llevar la lista de los ya
 * usados... o sea, un documento por state. Si de todas formas hay que escribir
 * en Firestore, el documento ES el state y no hace falta la segunda mitad.
 *
 * Además, el `code_verifier` de PKCE tiene que sobrevivir el viaje y NO puede
 * pasar por el navegador (si pasa, PKCE deja de proteger de la inyección de
 * code, que es justamente para lo que está). Un documento server-side es el
 * lugar natural; en un JWT habría que cifrarlo igual.
 *
 * El documento vive en una colección RAÍZ `oauth_states`, no bajo
 * `users/{uid}`: el callback recibe el state ANTES de saber de qué uid es —
 * ése es el dato que el state trae. Buscarlo bajo un uid exigiría que el uid
 * viajara por la URL, y un uid en la URL del callback es exactamente el ataque
 * que el state existe para impedir. `firestore.rules` la niega entera para
 * cualquier cliente.
 */
import { Timestamp, type Firestore, type Transaction } from "firebase-admin/firestore";
import { decrypt, encrypt, type EncryptedBlob, type MasterKey } from "./crypto.js";

export const STATES_COLLECTION = "oauth_states";

/** Diez minutos: el tiempo que puede tardar una persona en leer la pantalla de
 * Google, elegir cuenta y aceptar. Más que eso ya no es "el usuario está
 * pensando", es una URL guardada. */
export const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * El documento del state. El `code_verifier` va CIFRADO aunque la colección ya
 * esté negada al cliente: quien mire un export de Firestore, un backup o la
 * consola de Firebase ve un blob, no el verifier. Es la misma decisión que con
 * el refresh token, un nivel más abajo.
 *
 * El AAD del verifier es el propio id del state, no el uid: ata el blob a ESTE
 * state, así que ni siquiera copiándolo a otro documento sirve.
 */
export interface StateDoc {
  uid: string;
  verifier: EncryptedBlob;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  /** El instante en que se canjeó. `null` mientras no se usó. */
  usedAt: Timestamp | null;
  /** A dónde mandar al navegador al terminar. Se valida contra una allowlist
   * ANTES de guardarlo — nunca al leerlo. Ver `redirect.ts`. */
  returnTo: string;
}

export class StateError extends Error {
  constructor(readonly code: "state_desconocido" | "state_vencido" | "state_usado") {
    // El mensaje es el mismo para los tres a propósito: quien prueba states no
    // se entera de si acertó uno vencido o inventó uno.
    super("el state del OAuth no es utilizable");
    this.name = "StateError";
  }
}

export interface CrearStateOpts {
  db: Firestore;
  stateId: string;
  uid: string;
  verifier: string;
  returnTo: string;
  master: MasterKey;
  ahora?: Date;
}

export async function guardarState(opts: CrearStateOpts): Promise<void> {
  const ahora = opts.ahora ?? new Date();
  const doc: StateDoc = {
    uid: opts.uid,
    verifier: encrypt(opts.verifier, opts.stateId, opts.master),
    createdAt: Timestamp.fromDate(ahora),
    expiresAt: Timestamp.fromDate(new Date(ahora.getTime() + STATE_TTL_MS)),
    usedAt: null,
    returnTo: opts.returnTo,
  };
  // `create` y no `set`: si el id ya existiera (colisión imposible con 32 bytes,
  // pero un bug de generación no lo es) preferimos el error a pisar el state de
  // alguien que está a mitad de flujo.
  await opts.db.collection(STATES_COLLECTION).doc(opts.stateId).create(doc);
}

export interface StateCanjeado {
  uid: string;
  verifier: string;
  returnTo: string;
}

/**
 * Marca el state como usado y devuelve lo que guardaba. **Transaccional**: dos
 * callbacks con el mismo `code` que lleguen a la vez —el usuario haciendo doble
 * clic, un reintento del navegador— entran los dos a la transacción y sólo uno
 * sale con el verifier. El otro ve `usedAt` ya escrito y recibe `state_usado`.
 *
 * Sin la transacción, un `read` + `write` en dos pasos deja la ventana abierta
 * y los dos canjean; el segundo canje falla en Google (los `code` también son
 * de un solo uso) pero recién después de haber pasado la puerta.
 */
export async function canjearState(
  db: Firestore,
  stateId: string,
  master: MasterKey,
  ahora: Date = new Date()
): Promise<StateCanjeado> {
  const ref = db.collection(STATES_COLLECTION).doc(stateId);
  return db.runTransaction(async (tx: Transaction) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new StateError("state_desconocido");
    const doc = snap.data() as StateDoc;
    if (doc.usedAt !== null && doc.usedAt !== undefined) throw new StateError("state_usado");
    if (doc.expiresAt.toMillis() <= ahora.getTime()) throw new StateError("state_vencido");
    tx.update(ref, { usedAt: Timestamp.fromDate(ahora) });
    return {
      uid: doc.uid,
      // Si el AAD no cerrara, esto tira `DecryptError` y la transacción se
      // deshace: el state queda sin marcar y el error sube. Es el caso
      // "alguien editó el documento", y ahí no hay nada que consumir.
      verifier: decrypt(doc.verifier, stateId, [master]),
      returnTo: doc.returnTo,
    };
  });
}

/**
 * Borra los states vencidos. Firestore tiene TTL nativo por campo
 * (`expiresAt`), que es lo que hay que configurar en el proyecto real y borra
 * gratis; esta función existe para los tests y para el caso en que la política
 * TTL todavía no esté puesta. El límite de 500 es el tamaño máximo de un batch.
 */
export async function limpiarStatesVencidos(
  db: Firestore,
  ahora: Date = new Date(),
  limite = 500
): Promise<number> {
  const vencidos = await db
    .collection(STATES_COLLECTION)
    .where("expiresAt", "<=", Timestamp.fromDate(ahora))
    .limit(limite)
    .get();
  if (vencidos.empty) return 0;
  const batch = db.batch();
  for (const doc of vencidos.docs) batch.delete(doc.ref);
  await batch.commit();
  return vencidos.size;
}
