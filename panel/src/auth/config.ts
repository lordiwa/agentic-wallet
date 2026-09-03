/**
 * La config del SDK de Firebase, leída del build.
 *
 * **Nada precargado.** Igual que `VITE_FUNCTIONS_BASE_URL` en `api/gmail.ts`,
 * acá no hay ningún valor de un despliegue concreto: si el build no trae
 * `VITE_FIREBASE_API_KEY`, el panel no tiene identidad y sigue siendo el
 * local-first de siempre —se entra con la llave del server—. El piloto fija
 * estos valores en `panel/.env.demo` (CLAUDE.md, regla 3).
 *
 * **Estos valores son públicos.** La `apiKey` de Firebase viaja en el bundle
 * de cualquier navegador: identifica al proyecto, no autoriza nada. Lo que
 * autoriza son los dominios permitidos de Auth y las reglas de Firestore. El
 * `client_secret` del cliente OAuth es otra cosa y no está —ni puede estar—
 * de este lado.
 *
 * Sin `appId`: Firebase Auth no lo pide. Lo piden Analytics e Installations,
 * que este panel no usa, y pedirlo obligaría a registrar una Web App que el
 * proyecto no tiene.
 */
export interface ConfigFirebase {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

function leer(clave: string): string {
  const valor = (import.meta.env as Record<string, unknown> | undefined)?.[clave];
  return typeof valor === "string" ? valor.trim() : "";
}

/**
 * La config del build, o `null` si falta lo imprescindible.
 *
 * Los tres obligatorios son los tres que Auth usa: la llave para hablarle a
 * Identity Toolkit, el dominio donde se abre el popup de Google, y el proyecto
 * que firma el ID token que después verifican las funciones. Una config a
 * medias es peor que ninguna: `initializeApp` no falla, pero el login sí, y
 * recién en el click.
 */
export function configFirebase(): ConfigFirebase | null {
  const apiKey = leer("VITE_FIREBASE_API_KEY");
  const authDomain = leer("VITE_FIREBASE_AUTH_DOMAIN");
  const projectId = leer("VITE_FIREBASE_PROJECT_ID");
  if (apiKey === "" || authDomain === "" || projectId === "") return null;

  const config: ConfigFirebase = { apiKey, authDomain, projectId };
  const storageBucket = leer("VITE_FIREBASE_STORAGE_BUCKET");
  if (storageBucket !== "") config.storageBucket = storageBucket;
  const messagingSenderId = leer("VITE_FIREBASE_MESSAGING_SENDER_ID");
  if (messagingSenderId !== "") config.messagingSenderId = messagingSenderId;
  const appId = leer("VITE_FIREBASE_APP_ID");
  if (appId !== "") config.appId = appId;
  return config;
}

/** Si este build tiene identidad. Es la condición de la puerta de sesión. */
export function authConfigurado(): boolean {
  return configFirebase() !== null;
}
