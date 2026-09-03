/**
 * Conexión al emulador de Firestore para los tests.
 *
 * `hayEmulador` existe para que `npm test` sin emulador siga siendo verde: los
 * tests puros (derivación, paridad con el motor, auth) corren siempre, y los
 * que necesitan una base se saltean **anunciándolo**. Un test que se saltea en
 * silencio es peor que uno que falla.
 */
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

export const hayEmulador = process.env.FIRESTORE_EMULATOR_HOST !== undefined;

let contador = 0;

export interface EmuladorHandle {
  db: Firestore;
  app: App;
  cerrar: () => Promise<void>;
}

/** Una app de admin apuntando al emulador, con un nombre único por llamada
 * para que dos suites no compartan instancia. */
export function conectarEmulador(): EmuladorHandle {
  if (!hayEmulador) {
    throw new Error("no hay emulador: usa `hayEmulador` para saltear el test");
  }
  contador += 1;
  const app = initializeApp(
    { projectId: process.env.GCLOUD_PROJECT ?? "agentic-wallet-test" },
    `test-${contador}-${Date.now()}`
  );
  const db = getFirestore(app);
  return { db, app, cerrar: () => deleteApp(app) };
}

/** Borra recursivamente el ledger de un uid de prueba. */
export async function limpiarTenant(db: Firestore, uid: string): Promise<void> {
  await db.recursiveDelete(db.collection("users").doc(uid));
}

/** Un uid de prueba distinto en cada llamada, para que dos tests nunca
 * compartan tenant aunque corran a la vez. */
export function uidDePrueba(etiqueta: string): string {
  return `test-${etiqueta}-${Math.random().toString(36).slice(2, 10)}`;
}
