/**
 * Quién está entrado, sin saber nada de Firebase.
 *
 * Este módulo es el estado de la sesión y su API; el SDK vive en
 * `auth/firebase.ts` y entra por `setMotorAuth()`. La separación no es
 * decoración: los tests del panel corren sin proyecto y sin red, y el bundle
 * de `npm run dev` —que no tiene identidad— no carga el SDK ni una vez (es un
 * `import()` diferido en `main.ts`, ver `authConfigurado`).
 *
 * El estado tiene **tres** valores, no dos, y el tercero es el que importa:
 * `listo` distingue "no hay sesión" de "todavía no sé". Firebase resuelve la
 * sesión guardada de forma asíncrona, así que sin ese tercer estado un usuario
 * ya entrado vería parpadear la pantalla de login en cada F5.
 */
export interface Usuario {
  uid: string;
  email: string | null;
  nombre: string | null;
}

/** Lo que el panel necesita de un proveedor de identidad. Cuatro métodos: los
 * que hacen falta y ninguno más. */
export interface MotorAuth {
  /** Avisa el usuario actual —`null` si no hay— y en cada cambio. Devuelve
   * cómo dejar de escuchar. La primera notificación es la que marca `listo`. */
  observar(alCambiar: (usuario: Usuario | null) => void): () => void;
  entrarConGoogle(): Promise<void>;
  salir(): Promise<void>;
  /** El ID token fresco, o `null` si no hay sesión. */
  idToken(): Promise<string | null>;
}

export interface EstadoSesion {
  usuario: Usuario | null;
  /** Si ya se sabe si hay sesión. Mientras es `false` no se decide nada. */
  listo: boolean;
  /** Por qué no hay identidad disponible (el SDK no cargó, el login falló). */
  error: string | null;
}

let motor: MotorAuth | null = null;
let desuscribir: (() => void) | null = null;
let estado: EstadoSesion = { usuario: null, listo: false, error: null };

const oyentes = new Set<(e: EstadoSesion) => void>();

function publicar(nuevo: EstadoSesion): void {
  estado = nuevo;
  for (const oyente of oyentes) oyente(estado);
}

export function estadoSesion(): EstadoSesion {
  return estado;
}

/** Se suscribe a los cambios y recibe el estado actual de entrada, para que
 * quien llegue tarde no espere un cambio que ya pasó. */
export function observarSesion(oyente: (e: EstadoSesion) => void): () => void {
  oyentes.add(oyente);
  oyente(estado);
  return () => {
    oyentes.delete(oyente);
  };
}

/**
 * Registra el proveedor de identidad. Lo llama `main.ts` con el motor de
 * Firebase, y los tests con uno de mentira.
 */
export function setMotorAuth(nuevo: MotorAuth): void {
  desuscribir?.();
  motor = nuevo;
  desuscribir = nuevo.observar((usuario) => {
    publicar({ usuario, listo: true, error: null });
  });
}

/**
 * "No va a haber identidad": el build no la trae, o el SDK no cargó.
 *
 * Marca `listo` igual que una sesión resuelta. Sin esto, un `import()` que
 * falla —una red que se cortó a mitad— deja el panel en la pantalla de espera
 * para siempre, que es la peor de las tres salidas posibles.
 */
export function marcarSinAuth(error: string | null = null): void {
  publicar({ usuario: null, listo: true, error });
}

export async function entrarConGoogle(): Promise<void> {
  if (motor === null) throw new Error("no hay proveedor de identidad configurado");
  try {
    await motor.entrarConGoogle();
  } catch (e) {
    // El motor no cambia el estado cuando el login falla: el usuario sigue
    // afuera. Lo único que cambia es que ahora hay algo que contarle.
    publicar({ ...estado, listo: true, error: mensaje(e) });
    throw e;
  }
}

export async function cerrarSesion(): Promise<void> {
  if (motor === null) return;
  await motor.salir();
}

/**
 * El proveedor que `api/gmail.ts` inyecta con `setProveedorIdToken`.
 *
 * Devuelve `null` —y no lanza— cuando no hay identidad: para el botón de Gmail
 * "no hay sesión" y "no hay Firebase en este build" son el mismo caso.
 */
export async function idTokenActual(): Promise<string | null> {
  if (motor === null) return null;
  return motor.idToken();
}

/** Sólo para los tests: devuelve el módulo a su estado inicial. */
export function reiniciarSesion(): void {
  desuscribir?.();
  desuscribir = null;
  motor = null;
  oyentes.clear();
  estado = { usuario: null, listo: false, error: null };
}

function mensaje(e: unknown): string {
  if (e instanceof Error && e.message !== "") return e.message;
  return "No se pudo entrar.";
}
