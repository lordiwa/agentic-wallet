/**
 * El borde de Firebase: acá y sólo acá se inicializa el SDK de admin y se
 * declaran las funciones. Toda la lógica está en `api/handlers.ts`, que se
 * puede testear sin este archivo.
 *
 * **2a generación** (`firebase-functions/v2`), no 1a. La razón que decide es el
 * timeout: la 1a gen corta a 540 s y la ingesta del primer sync de un buzón
 * real son miles de correos; la 2a llega a 3600 s en funciones HTTP y a 540 s
 * en las de evento. Ver `docs/pivot-firebase.md` §1.3.
 *
 * `region: us-central1` porque es donde ya vive el proyecto de Hosting: cruzar
 * regiones entre Hosting, Functions y Firestore agrega latencia y egreso
 * facturado por nada.
 */
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { onRequest } from "firebase-functions/v2/https";
import { healthHandler, overviewHandler } from "./api/handlers.js";
import {
  gmailCallbackHandler,
  gmailStartHandler,
  gmailStatusHandler,
} from "./api/gmail-oauth.js";
import { ingestHandler } from "./api/ingest.js";
import { cargarConfig } from "./oauth/config.js";

const app = initializeApp();
const db = getFirestore(app);
const auth = getAuth(app);

/** La version que reporta /health. Sale del package.json en el build real. */
const VERSION = process.env.WALLET_FUNCTIONS_VERSION ?? "0.1.0";

/**
 * Los dos secretos del flujo OAuth, en Secret Manager.
 *
 * `defineSecret` no los lee acá: declara que estas funciones los necesitan. El
 * runtime los monta como variables de entorno **sólo en las funciones que los
 * declaran en su `secrets: [...]`**, y esa lista es la que hace que
 * `gmailAuthStatus` —que no tiene por qué tocar un token— no tenga la clave
 * maestra en su proceso ni siquiera por accidente. Es el mismo principio de
 * mínimo privilegio que en `firestore.rules`, aplicado al runtime.
 *
 * Se cargan con:
 *   firebase functions:secrets:set WALLET_TOKEN_KEK
 *   firebase functions:secrets:set WALLET_GMAIL_CLIENT_SECRET
 * Nunca en un archivo del repo, nunca en `.env`, nunca en un commit.
 */
const TOKEN_KEK = defineSecret("WALLET_TOKEN_KEK");
const GMAIL_CLIENT_SECRET = defineSecret("WALLET_GMAIL_CLIENT_SECRET");

/**
 * La config del OAuth se arma DENTRO del handler, no en el módulo.
 *
 * Es obligatorio: en el arranque del módulo los secretos todavía no están
 * montados en `process.env`, así que un `cargarConfig()` de nivel superior
 * fallaría en el deploy —cuando Functions carga el archivo para descubrir qué
 * exporta— aunque en runtime el secreto exista. Ver la nota de
 * `firebase-functions/params` sobre acceso a secretos en el cuerpo de la
 * función.
 */
function configOAuth() {
  return cargarConfig(process.env);
}

/** Los parámetros comunes de las tres funciones del OAuth. */
const OAUTH_RUNTIME = {
  region: "us-central1" as const,
  invoker: "public" as const,
  memory: "256MiB" as const,
  timeoutSeconds: 30,
  maxInstances: 10,
};

export const health = onRequest(
  {
    region: "us-central1",
    // Sin auth de IAM: es el healthcheck publico.
    invoker: "public",
    memory: "256MiB",
    timeoutSeconds: 10,
    // 1 instancia caliente para que el primer request del dia no pague el
    // cold start. Cuesta unos centavos al mes y es lo que hace que el panel
    // no parezca roto al abrirlo.
    minInstances: 0,
    maxInstances: 10,
  },
  healthHandler(VERSION)
);

export const overview = onRequest(
  {
    region: "us-central1",
    invoker: "public", // la autorizacion la hace el ID token, no IAM
    memory: "512MiB",
    timeoutSeconds: 60,
    maxInstances: 20,
    // Concurrencia por instancia: varias peticiones comparten proceso. Por eso
    // NADA de estado global por tenant en este runtime (ver derive.ts sobre el
    // huso horario).
    concurrency: 20,
  },
  overviewHandler({ auth, db })
);

/**
 * `POST /gmailAuthStart` — arranca el consentimiento de Gmail.
 *
 * `concurrency: 1` en las tres funciones del OAuth, a diferencia de `overview`.
 * No es por el estado —no hay estado global acá— sino por el material que
 * tienen en memoria: con concurrencia 1, el proceso que está manejando el
 * canje de una persona no está manejando el de otra a la vez. Es una capa
 * barata contra un bug de aliasing en el que un refresh token termine en el
 * tenant equivocado. El volumen lo permite: esto se llama una vez por usuario,
 * no una vez por pantalla.
 */
export const gmailAuthStart = onRequest(
  { ...OAUTH_RUNTIME, concurrency: 1, secrets: [TOKEN_KEK, GMAIL_CLIENT_SECRET] },
  (req, res) => gmailStartHandler({ auth, db, config: configOAuth() })(req, res)
);

/**
 * `GET /gmailAuthCallback` — la vuelta de Google.
 *
 * `invoker: "public"` es obligatorio y no es un descuido: quien la llama es el
 * navegador siguiendo un redirect de accounts.google.com, sin credenciales
 * nuestras. Lo que la protege es el `state` (un solo uso, 10 minutos, opaco) y
 * el `client_secret`, que un tercero no tiene. Ver `api/gmail-oauth.ts`.
 *
 * Esta URL es la que va en "Authorized redirect URIs" del cliente OAuth:
 * https://us-central1-agentic-wallet-71314.cloudfunctions.net/gmailAuthCallback
 */
export const gmailAuthCallback = onRequest(
  { ...OAUTH_RUNTIME, concurrency: 1, secrets: [TOKEN_KEK, GMAIL_CLIENT_SECRET] },
  (req, res) => gmailCallbackHandler({ auth, db, config: configOAuth() })(req, res)
);

/**
 * `GET /gmailAuthStatus` — ¿conectado?
 *
 * **Sin `secrets`.** Esta función no descifra nada, así que no necesita la
 * clave maestra, y no tenerla es la garantía más fuerte de que no la puede
 * filtrar: no está en su proceso.
 */
export const gmailAuthStatus = onRequest(
  { ...OAUTH_RUNTIME, concurrency: 20 },
  gmailStatusHandler({ auth, db })
);

/**
 * `POST /ingest` — lee el Gmail del usuario y escribe en su ledger.
 *
 * `timeoutSeconds: 540` y `concurrency: 1`, que es lo contrario de `overview`.
 * El timeout largo es LA razón por la que este proyecto usa 2a gen (ver el doc
 * de arriba): el primer sync de un buzón real son miles de correos. La
 * concurrencia 1 es por lo mismo que en el OAuth —este proceso tiene el refresh
 * token descifrado en memoria— y además porque una corrida es pesada: dos en el
 * mismo proceso se pelean el CPU y las dos tardan el doble.
 *
 * `maxInstances: 5` acota el gasto: es una función que habla con Gmail y
 * escribe documentos, o sea la única acá que puede costar plata de verdad si se
 * la llama en un bucle.
 */
export const ingest = onRequest(
  {
    region: "us-central1",
    invoker: "public", // la autorizacion la hace el ID token, no IAM
    memory: "512MiB",
    timeoutSeconds: 540,
    concurrency: 1,
    maxInstances: 5,
    secrets: [TOKEN_KEK, GMAIL_CLIENT_SECRET],
  },
  (req, res) => ingestHandler({ auth, db, config: configOAuth() })(req, res)
);
