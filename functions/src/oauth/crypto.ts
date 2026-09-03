/**
 * El cifrado de los tokens de Gmail en reposo.
 *
 * Este archivo no sabe qué es un refresh token: cifra un string con una clave
 * maestra y lo ata a un contexto. Todo lo demás (dónde vive el blob, quién lo
 * lee) está en `gmail-tokens.ts`. La separación importa porque este módulo se
 * testea sin Firestore y sin red.
 *
 * **AES-256-GCM con AAD**, no AES-CBC ni un `crypto.createCipher` cualquiera.
 * Las tres decisiones que no son obvias:
 *
 * 1. **GCM y no CBC** porque GCM autentica: si alguien con escritura en
 *    Firestore le cambia un byte al ciphertext, el descifrado FALLA en vez de
 *    devolver basura. Con CBC devolvería basura y el error aparecería mucho
 *    más tarde, en la llamada a Google, como un "token inválido" que no dice
 *    nada de que alguien tocó la base.
 * 2. **El AAD es el uid.** Es lo que impide mover un blob cifrado de un tenant
 *    a otro: el ciphertext de Ana descifrado con `aad = uid de Beto` no
 *    devuelve el token de Ana, tira `Unsupported state or unable to
 *    authenticate data`. Sin AAD, quien pueda escribir un documento de
 *    Firestore puede copiar el blob de otra persona al suyo y la ingesta leería
 *    el buzón equivocado con total normalidad. Ver `docs/pivot-firebase.md`
 *    §B.2, ataque 2.
 * 3. **`keyVersion` viaja en el documento desde el día uno.** Sin él, rotar la
 *    clave maestra obliga a que todo el mundo vuelva a consentir. Con él, la
 *    rotación es descifrar con la vieja y reescribir con la nueva, tenant por
 *    tenant, sin que nadie se entere.
 *
 * El IV es de 12 bytes ALEATORIO por escritura, que es el tamaño nativo de GCM
 * (uno de otro largo obliga a GHASH a derivarlo y pierde la garantía de
 * unicidad barata). Repetir un IV con la misma clave en GCM no es "un poco
 * peor": rompe la confidencialidad y deja falsificar el tag. Por eso nunca hay
 * un contador acá, sólo `randomBytes`.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/** Bytes de la clave maestra. AES-256 y no 128: la diferencia de costo es
 * ruido y la clave la genera una máquina, no una persona. */
export const KEY_BYTES = 32;
/** Tamaño nativo del IV de GCM. */
export const IV_BYTES = 12;
/** Tamaño del tag de autenticación de GCM. */
export const TAG_BYTES = 16;

export const ALG = "AES-256-GCM" as const;

/** El blob tal como se guarda en Firestore. Todo base64: Firestore tiene un
 * tipo `Bytes`, pero un string base64 sobrevive a un export/import de JSON sin
 * que nadie tenga que acordarse de reconstruir el tipo. */
export interface EncryptedBlob {
  alg: typeof ALG;
  keyVersion: number;
  iv: string;
  ciphertext: string;
  tag: string;
}

/** Una clave maestra con su versión. La versión NO es decorativa: es la que
 * permite tener dos claves vivas a la vez durante una rotación. */
export interface MasterKey {
  version: number;
  key: Buffer;
}

/**
 * Lee la clave maestra de una variable de entorno con base64 (en producción,
 * el secreto `WALLET_TOKEN_KEK` de Secret Manager, que el runtime de Functions
 * inyecta como env var).
 *
 * Falla ruidosamente si falta o si mide mal. Un default silencioso acá sería
 * una clave conocida cifrando tokens de Gmail reales: preferible que la función
 * no arranque.
 */
export function masterKeyFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  variable = "WALLET_TOKEN_KEK",
  versionVariable = "WALLET_TOKEN_KEK_VERSION"
): MasterKey {
  const raw = env[variable];
  if (raw === undefined || raw.trim() === "") {
    throw new Error(`falta ${variable}: no hay clave maestra para cifrar los tokens`);
  }
  const key = Buffer.from(raw.trim(), "base64");
  if (key.length !== KEY_BYTES) {
    // El largo se dice, el contenido nunca.
    throw new Error(`${variable} tiene ${key.length} bytes y se esperaban ${KEY_BYTES}`);
  }
  const version = Number.parseInt(env[versionVariable] ?? "1", 10);
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`${versionVariable} tiene que ser un entero >= 1`);
  }
  return { version, key };
}

/** Genera una clave maestra nueva en base64, para cargarla a Secret Manager.
 * No se usa en runtime: existe para el script de alta y para los tests. */
export function generarClaveMaestra(): string {
  return randomBytes(KEY_BYTES).toString("base64");
}

/**
 * Cifra `plaintext` atándolo a `aad`.
 *
 * `aad` (additional authenticated data) no se cifra, se AUTENTICA: viaja en
 * claro —de hecho ni siquiera viaja, lo reconstruye quien descifra— pero si no
 * coincide, el descifrado falla. Acá es el uid.
 */
export function encrypt(plaintext: string, aad: string, master: MasterKey): EncryptedBlob {
  if (master.key.length !== KEY_BYTES) {
    throw new Error("la clave maestra no mide 32 bytes");
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", master.key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    alg: ALG,
    keyVersion: master.version,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export class DecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecryptError";
  }
}

/**
 * Descifra un blob. `claves` es el juego de claves vivas: durante una rotación
 * hay dos, y el blob elige la suya por `keyVersion`.
 *
 * Cualquier fallo —tag que no cierra, uid que no es el del blob, versión de
 * clave que ya no existe— sale como `DecryptError` con un mensaje que NO
 * distingue el caso. La distinción sería un oráculo: "el tag falló" contra "la
 * versión no existe" le dice a quien esté probando qué parte del documento
 * manipular.
 */
export function decrypt(blob: EncryptedBlob, aad: string, claves: readonly MasterKey[]): string {
  if (blob.alg !== ALG) {
    throw new DecryptError("no se pudo descifrar el token");
  }
  const master = claves.find((k) => k.version === blob.keyVersion);
  if (master === undefined) {
    throw new DecryptError("no se pudo descifrar el token");
  }
  const iv = Buffer.from(blob.iv, "base64");
  const tag = Buffer.from(blob.tag, "base64");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new DecryptError("no se pudo descifrar el token");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", master.key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(blob.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new DecryptError("no se pudo descifrar el token");
  }
}

/**
 * Comparación de strings en tiempo constante, para el `state` del OAuth.
 *
 * `a === b` en JS corta en el primer byte distinto, y esa diferencia de tiempo
 * es medible sobre la red con suficientes intentos. Acá lo que se compara es un
 * identificador que autoriza escribir el token de alguien: vale los microsegundos.
 */
export function igualSeguro(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // `timingSafeEqual` exige el mismo largo. El largo sí se filtra, y no importa:
  // el de un state es fijo.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
