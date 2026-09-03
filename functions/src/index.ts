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
import { onRequest } from "firebase-functions/v2/https";
import { healthHandler, overviewHandler } from "./api/handlers.js";

const app = initializeApp();
const db = getFirestore(app);
const auth = getAuth(app);

/** La version que reporta /health. Sale del package.json en el build real. */
const VERSION = process.env.WALLET_FUNCTIONS_VERSION ?? "0.1.0";

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
