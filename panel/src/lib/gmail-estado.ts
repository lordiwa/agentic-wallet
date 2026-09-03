/**
 * Qué mostrar en la tarjeta de Gmail, como función pura.
 *
 * Mismo reparto que `sync-estado.ts`: el componente dibuja y esta función
 * decide. La decisión no es trivial —hay seis estados y siete resultados
 * posibles del callback— y meterla en el `.vue` la volvería intesteable sin
 * montar un árbol entero.
 *
 * La distinción que ordena todo lo demás es **"nunca conectaste" vs. "tu
 * conexión dejó de servir"**. Son la misma pantalla para el backend
 * (`conectado` + `necesitaReconectar`) y dos acciones distintas para la
 * persona: una es un alta, la otra es reparar algo que ya andaba. Ver
 * `functions/src/oauth/gmail-tokens.ts`, que expone `necesitaReconectar`
 * justamente para que el panel las pueda separar.
 */

/** Lo que devuelve `GET /gmailAuthStatus`. Copia del `EstadoGmail` de
 * `functions/src/oauth/gmail-tokens.ts`: sin blob, sin bytes, sin token. */
export interface EstadoGmail {
  conectado: boolean;
  email: string | null;
  scopes: string[];
  grantedAt: string | null;
  necesitaReconectar: boolean;
}

/** Los códigos con los que el callback vuelve al panel en `?gmail=`. Copia de
 * `ResultadoCallback` de `functions/src/api/gmail-oauth.ts`. */
export type ResultadoCallback =
  | "ok"
  | "cancelado"
  | "state_invalido"
  | "sin_refresh_token"
  | "scope_insuficiente"
  | "google_rechazo"
  | "error";

const RESULTADOS: readonly string[] = [
  "ok",
  "cancelado",
  "state_invalido",
  "sin_refresh_token",
  "scope_insuficiente",
  "google_rechazo",
  "error",
];

/**
 * Lee `?gmail=` de una query string. Devuelve `null` si no viene o si trae algo
 * que no es un resultado conocido.
 *
 * Se valida contra la lista en vez de confiar en el string porque el valor
 * llega por la URL y termina eligiendo un texto en pantalla: sin la lista,
 * `?gmail=<script>` sería un mensaje que el panel se cree.
 */
export function leerResultado(search: string): ResultadoCallback | null {
  const valor = new URLSearchParams(search).get("gmail");
  if (valor === null || !RESULTADOS.includes(valor)) return null;
  return valor as ResultadoCallback;
}

export type TonoAviso = "ok" | "warn" | "bad";

export interface Aviso {
  texto: string;
  tono: TonoAviso;
}

/**
 * El texto de cada resultado del callback.
 *
 * `sin_refresh_token` es el único que explica qué hacer en vez de qué pasó: es
 * el caso en que Google no reemite el refresh token porque la cuenta ya había
 * autorizado el cliente, y lo único que lo arregla es volver a intentar (la URL
 * lleva `prompt=consent`, así que la segunda vez sí viene).
 */
const AVISOS: Record<ResultadoCallback, Aviso> = {
  ok: { texto: "Listo, Gmail quedó conectado.", tono: "ok" },
  cancelado: { texto: "Cancelaste el permiso en la pantalla de Google.", tono: "warn" },
  state_invalido: {
    texto: "El pedido venció o ya se había usado. Probá de nuevo.",
    tono: "warn",
  },
  sin_refresh_token: {
    texto: "Google no devolvió el permiso permanente. Volvé a intentar y aceptá de nuevo.",
    tono: "warn",
  },
  scope_insuficiente: {
    texto: "Faltó aceptar el permiso de lectura de Gmail. Sin eso no se puede leer nada.",
    tono: "bad",
  },
  google_rechazo: { texto: "Google rechazó el pedido. Probá de nuevo en un rato.", tono: "bad" },
  error: { texto: "No se pudo completar la conexión.", tono: "bad" },
};

/** Lo que sabe el composable cuando le toca dibujar. */
export interface EntradaGmail {
  /** `null` mientras no se sabe: no es lo mismo que "desconectado". */
  estado: EstadoGmail | null;
  cargando: boolean;
  /** Falló `gmailAuthStatus` o `gmailAuthStart`. */
  error: string | null;
  /** Lo que trajo `?gmail=` al volver de Google. */
  resultado: ResultadoCallback | null;
  /** Hay un ID token de Firebase disponible. Sin esto no hay a quién conectarle
   * un buzón, así que el botón no puede ni ofrecerse. */
  haySesion: boolean;
  /** El panel sabe a qué URL hablarle (`VITE_FUNCTIONS_BASE_URL`). */
  configurado: boolean;
}

export type EstadoVista =
  | "cargando"
  | "sin-configurar"
  | "sin-sesion"
  | "desconectado"
  | "conectado"
  | "reconectar"
  | "error";

export interface VistaGmail {
  estado: EstadoVista;
  titulo: string;
  detalle: string;
  /** `null` cuando no hay acción que ofrecer. */
  boton: string | null;
  botonClase: "primario" | "secundario";
  habilitado: boolean;
  aviso: Aviso | null;
}

/** `2026-09-03T...` -> `3 de septiembre de 2026`. Devuelve `""` si no parsea:
 * una fecha rota no vale una excepción en una tarjeta. */
export function formatearFecha(iso: string | null): string {
  if (iso === null) return "";
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";
  return fecha.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * El estado de la tarjeta.
 *
 * El orden de los `if` es la prioridad: primero lo que impide actuar (sin
 * configurar, sin sesión), después lo que está en curso (cargando), y recién
 * ahí lo que dice el backend. Un error de red **no** pisa un "conectado" que ya
 * se había leído: si sabemos que el buzón está conectado, que la última
 * consulta haya fallado es un detalle, no una desconexión.
 */
export function vistaGmail(entrada: EntradaGmail): VistaGmail {
  const aviso = entrada.resultado === null ? null : AVISOS[entrada.resultado];

  if (!entrada.configurado) {
    return {
      estado: "sin-configurar",
      titulo: "Gmail no está configurado",
      detalle: "A este panel le falta la dirección del backend para conectar el correo.",
      boton: null,
      botonClase: "secundario",
      habilitado: false,
      aviso,
    };
  }

  if (!entrada.haySesion) {
    return {
      estado: "sin-sesion",
      titulo: "Entrá para conectar tu correo",
      detalle: "Conectar Gmail necesita una sesión iniciada.",
      boton: null,
      botonClase: "secundario",
      habilitado: false,
      aviso,
    };
  }

  if (entrada.cargando && entrada.estado === null) {
    return {
      estado: "cargando",
      titulo: "Viendo si tenés Gmail conectado…",
      detalle: "",
      boton: null,
      botonClase: "secundario",
      habilitado: false,
      aviso,
    };
  }

  if (entrada.estado === null) {
    return {
      estado: "error",
      titulo: "No se pudo consultar el estado",
      detalle: entrada.error ?? "Probá de nuevo.",
      boton: "Reintentar",
      botonClase: "secundario",
      habilitado: !entrada.cargando,
      aviso,
    };
  }

  if (entrada.estado.conectado && entrada.estado.necesitaReconectar) {
    return {
      estado: "reconectar",
      titulo: "Hay que reconectar Gmail",
      detalle: "Google dejó de aceptar el permiso. Tus datos siguen acá; falta renovar el acceso.",
      boton: "Reconectar",
      botonClase: "primario",
      habilitado: !entrada.cargando,
      aviso,
    };
  }

  if (entrada.estado.conectado) {
    const desde = formatearFecha(entrada.estado.grantedAt);
    return {
      estado: "conectado",
      titulo: "Gmail conectado",
      detalle: [entrada.estado.email, desde === "" ? "" : `desde el ${desde}`]
        .filter((parte) => parte !== null && parte !== "")
        .join(" · "),
      boton: "Reconectar",
      botonClase: "secundario",
      habilitado: !entrada.cargando,
      aviso,
    };
  }

  return {
    estado: "desconectado",
    titulo: "Conectá tu Gmail",
    detalle: "Sólo se leen los correos de aviso de tu banco. Podés revocarlo cuando quieras.",
    boton: "Conectar Gmail",
    botonClase: "primario",
    habilitado: !entrada.cargando,
    aviso,
  };
}
