/**
 * En qué estado está el sync, y qué dice el botón. **Función pura**: entra lo
 * que contestaron `GET /api/sync/status` y `POST /api/sync`, sale lo que el
 * chip dibuja. Vive afuera del componente para poder probar los cinco estados
 * sin montar nada.
 *
 * El estado nunca se adivina (`c1-boton-sync.html`): sale de `last_sync_ts`, de
 * `backlog`, de `running` y del código de respuesta.
 *
 * De los ocho estados dibujados en `c1`, el MVP usa **cinco**:
 *
 * | del sistema | acá |
 * |---|---|
 * | al día, atrasado, nunca, corriendo, falló | son los cinco |
 * | *a medias* | se dibuja **como corriendo, con el pendiente al lado** — misma barra, botón *Seguir* |
 * | *otro lo está corriendo* (409) | comparte el cartel de falla, con su texto |
 * | *sin configurar* (503) | comparte el cartel de falla, con su texto |
 *
 * Y una cosa que el sistema dibuja y acá **no** existe: *Detener*. El runner
 * escribe el progreso una vez por lote, al final (`sync/run-sync.ts`), así que
 * un botón de detener no detendría nada — sería un control que miente (H18).
 */
import { syncFreshness, timeAgo } from "./freshness";
import { formatoEntero } from "./formato";

export type EstadoSync = "nunca" | "al-dia" | "atrasado" | "corriendo" | "fallo";

/** El código con el que falló, que es lo que cambia el texto. `otro` incluye
 * el 500 con el mensaje del server. */
export interface FallaSync {
  codigo: 409 | 503 | "otro";
  /** El mensaje del server, tal cual. Vacío si no mandó ninguno. */
  mensaje: string;
}

export interface Backlog {
  processed: number;
  total: number;
  remaining: number;
}

export interface EntradaSync {
  lastSyncTs: string | null;
  backlog: Backlog | null;
  /** Lo que el server dice de sí mismo (R9). Sobrevive a un F5. */
  running: boolean;
  /** Esta pestaña disparó un `POST /api/sync` que todavía no volvió. */
  enVuelo: boolean;
  falla: FallaSync | null;
}

export interface ProgresoVista {
  processed: number;
  total: number;
  remaining: number;
  /** 0..100, ya redondeado, para el ancho de la barra. */
  porcentaje: number;
  /** "1.240 de 3.800". */
  texto: string;
}

export interface VistaSync {
  estado: EstadoSync;
  /** Lo que dice el botón. */
  boton: string;
  /** La clase del botón, de las del sistema. */
  botonClase: "ok" | "warnb" | "pri" | "dis" | "badb";
  /** La línea en negrita del `.meta`. */
  titulo: string;
  /** La línea de abajo. Vacía cuando no hay nada honesto que decir. */
  detalle: string;
  metaClase: "" | "ok" | "warn" | "bad";
  progreso: ProgresoVista | null;
  /** Si el botón hace algo al tocarlo. */
  habilitado: boolean;
}

function progresoDe(backlog: Backlog): ProgresoVista {
  const porcentaje = backlog.total > 0 ? Math.round((backlog.processed / backlog.total) * 100) : 0;
  return {
    processed: backlog.processed,
    total: backlog.total,
    remaining: backlog.remaining,
    porcentaje,
    texto: `${formatoEntero(backlog.processed)} de ${formatoEntero(backlog.total)}`,
  };
}

function tituloDeFalla(falla: FallaSync): string {
  switch (falla.codigo) {
    case 409:
      return "Ya hay un sync en curso";
    case 503:
      return "Falta conectar Gmail";
    default:
      return "El sync falló";
  }
}

/**
 * El detalle de una falla. El 409 y el 503 comparten el cartel pero no el
 * texto: uno es "esperá", el otro es "falta una credencial", y tratarlos igual
 * haría que el segundo parezca que se arregla solo.
 */
function detalleDeFalla(falla: FallaSync): string {
  switch (falla.codigo) {
    case 409:
      return "Otro lo está corriendo. No se reintenta solo: un lote tarda minutos.";
    case 503:
      return "El server no tiene credencial de Gmail configurada.";
    default:
      // El mensaje del server, tal cual — no se traduce ni se adorna.
      return falla.mensaje;
  }
}

export function vistaSync(entrada: EntradaSync, now: Date = new Date()): VistaSync {
  if (entrada.falla !== null) {
    return {
      estado: "fallo",
      boton: "Reintentar",
      botonClase: "badb",
      titulo: tituloDeFalla(entrada.falla),
      detalle: detalleDeFalla(entrada.falla),
      metaClase: "bad",
      progreso: entrada.backlog ? progresoDe(entrada.backlog) : null,
      habilitado: true,
    };
  }

  // Corriendo de verdad: o lo disparó esta pestaña, o el server dice que hay
  // uno en vuelo (R9 — es lo que hace que un F5 en medio de un lote no
  // rehidrate en un estado limpio falso).
  if (entrada.enVuelo || entrada.running) {
    return {
      estado: "corriendo",
      boton: "Sincronizando…",
      botonClase: "dis",
      titulo: "Sincronizando",
      detalle: entrada.backlog ? "" : "Leyendo el buzón.",
      metaClase: "",
      progreso: entrada.backlog ? progresoDe(entrada.backlog) : null,
      habilitado: false,
    };
  }

  // A medias: el sistema lo dibuja como corriendo —misma barra— pero el botón
  // es *Seguir* y está habilitado. Encadenar solo hasta terminar sería el único
  // bucle de requests sin supervisión del panel; es un botón a propósito.
  if (entrada.backlog !== null) {
    const progreso = progresoDe(entrada.backlog);
    return {
      estado: "corriendo",
      boton: "Seguir",
      botonClase: "warnb",
      titulo: `Quedaron ${formatoEntero(entrada.backlog.remaining)} por procesar`,
      detalle: progreso.texto,
      metaClase: "warn",
      progreso,
      habilitado: true,
    };
  }

  const frescura = syncFreshness(entrada.lastSyncTs, false, now);

  if (frescura === "nunca") {
    return {
      estado: "nunca",
      boton: "Sincronizar por primera vez",
      botonClase: "pri",
      titulo: "Nunca sincronizaste",
      // Sin fecha inventada (regla 2 de §2.3): no hay un "hace X" que decir.
      detalle: "",
      metaClase: "",
      progreso: null,
      habilitado: true,
    };
  }

  if (frescura === "atrasado") {
    return {
      estado: "atrasado",
      boton: "Sincronizar",
      botonClase: "warnb",
      titulo: `Última vez ${timeAgo(entrada.lastSyncTs, now)}`,
      detalle: "Pasó el umbral de frescura.",
      metaClase: "warn",
      progreso: null,
      habilitado: true,
    };
  }

  return {
    estado: "al-dia",
    boton: "Sincronizar",
    botonClase: "ok",
    titulo: `Sincronizado ${timeAgo(entrada.lastSyncTs, now)}`,
    detalle: "Sin correo pendiente.",
    metaClase: "ok",
    progreso: null,
    habilitado: true,
  };
}

/** La etiqueta `.tag` del estado, para la cabecera del Resumen
 * (`p2-resumen.html` la muestra al lado de "actualizado hace X"). */
export function tagSync(estado: EstadoSync): { clase: "ok" | "warn" | "bad" | "neu" | "acc"; texto: string } {
  switch (estado) {
    case "al-dia":
      return { clase: "ok", texto: "Al día" };
    case "atrasado":
      return { clase: "warn", texto: "Atrasado" };
    case "nunca":
      return { clase: "neu", texto: "Nunca" };
    case "corriendo":
      return { clase: "acc", texto: "Sincronizando" };
    case "fallo":
      return { clase: "bad", texto: "Falló" };
  }
}
