/**
 * El ciclo del consentimiento de Gmail visto desde el panel.
 *
 * Tres cosas pasan acá y en ningún otro lado:
 *
 * 1. **Se consulta el estado** (`gmailAuthStatus`) al montar y después de cada
 *    vuelta de Google.
 * 2. **Se arranca el consentimiento** (`gmailAuthStart`) y se manda el
 *    navegador a `authUrl`.
 * 3. **Se lee el `?gmail=` de la vuelta** y se limpia de la barra de
 *    direcciones, para que un F5 no vuelva a mostrar "listo, quedó conectado"
 *    tres días después. Es el mismo motivo de `dismissPendingApiBase` en
 *    `api/base.ts`.
 *
 * `fetchImpl`, `navegar` y `search` entran por parámetro: así el ciclo entero
 * se prueba sin red, sin `window.location` real y sin un proyecto de Firebase.
 */
import { computed, onMounted, ref, type ComputedRef, type Ref } from "vue";
import { isDemoMode } from "../api/base";
import {
  GmailApiError,
  consultarEstadoGmail,
  gmailConfigurado,
  iniciarConexionGmail,
  obtenerIdToken,
} from "../api/gmail";
import {
  leerResultado,
  vistaGmail,
  type EstadoGmail,
  type ResultadoCallback,
  type VistaGmail,
} from "../lib/gmail-estado";

export interface OpcionesGmail {
  fetchImpl?: typeof fetch;
  /** Qué hacer con la `authUrl`. Por defecto: navegar esta misma pestaña. */
  navegar?: (url: string) => void;
  /** La query string de la que sale `?gmail=`. Por defecto la de la ventana. */
  search?: string;
  /** La ruta del panel a la que volver después de Google. Debe empezar con "/". */
  returnTo?: string;
  /** Consultar el estado al montar. `false` en los tests que arman el suyo. */
  auto?: boolean;
}

export interface Gmail {
  vista: ComputedRef<VistaGmail>;
  estado: Ref<EstadoGmail | null>;
  refrescar: () => Promise<void>;
  conectar: () => Promise<void>;
  /** Lo que hace el botón según el estado: reintentar o conectar. Existe para
   * que el componente tenga un solo `@click` y no repita la decisión. */
  accionar: () => Promise<void>;
}

/**
 * Saca `?gmail=` de la barra sin recargar ni tocar el hash.
 *
 * El hash se preserva entero porque es la ruta: el callback vuelve a
 * `/?gmail=ok#/conectado` y perder el `#/conectado` mandaría al usuario al
 * Resumen justo cuando le íbamos a decir que quedó conectado.
 */
function limpiarResultado(): void {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("gmail")) return;
  url.searchParams.delete("gmail");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export function useGmail(opciones: OpcionesGmail = {}): Gmail {
  const fetchImpl = opciones.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const navegar =
    opciones.navegar ??
    ((url: string) => {
      window.location.assign(url);
    });
  const search = opciones.search ?? (typeof window === "undefined" ? "" : window.location.search);

  const estado = ref<EstadoGmail | null>(null);
  const cargando = ref(false);
  const error = ref<string | null>(null);
  const haySesion = ref(false);
  const resultado = ref<ResultadoCallback | null>(leerResultado(search));

  // El aviso ya se leyó a memoria: la URL puede quedar limpia desde el primer
  // instante y el mensaje sigue en pantalla hasta que el usuario navegue.
  if (resultado.value !== null) limpiarResultado();

  const vista = computed(() =>
    vistaGmail({
      estado: estado.value,
      cargando: cargando.value,
      error: error.value,
      resultado: resultado.value,
      haySesion: haySesion.value,
      // El modo demostración no habla con ninguna función, así que no le falta
      // ninguna URL: pedirle `VITE_FUNCTIONS_BASE_URL` dejaría el panel público
      // mostrando "Gmail no está configurado" en una pantalla que es toda
      // ficción a propósito.
      configurado: gmailConfigurado() || isDemoMode(),
    })
  );

  async function refrescar(): Promise<void> {
    if (cargando.value) return;
    cargando.value = true;
    error.value = null;
    try {
      // En demo no hay a quién pedirle un ID token y tampoco hace falta: las
      // respuestas son ficticias y no salen de esta pestaña.
      haySesion.value = isDemoMode() || (await obtenerIdToken()) !== null;
      // Sin sesión no se pregunta: la respuesta sería un 401 y la vista ya
      // tiene un estado propio para "entrá primero".
      if (!haySesion.value) {
        estado.value = null;
        return;
      }
      estado.value = await consultarEstadoGmail(fetchImpl);
    } catch (e) {
      error.value = e instanceof GmailApiError ? e.message : "No se pudo consultar el estado.";
      // `estado` NO se limpia: si ya sabíamos que estaba conectado, una consulta
      // que falla no es una desconexión (ver `vistaGmail`).
    } finally {
      cargando.value = false;
    }
  }

  async function conectar(): Promise<void> {
    if (cargando.value) return;
    cargando.value = true;
    error.value = null;
    try {
      const { authUrl } = await iniciarConexionGmail(opciones.returnTo, fetchImpl);
      // El aviso viejo se va: lo que sigue en pantalla es el viaje nuevo.
      resultado.value = null;
      navegar(authUrl);
    } catch (e) {
      error.value = e instanceof GmailApiError ? e.message : "No se pudo arrancar la conexión.";
    } finally {
      // `cargando` se libera aunque la navegación haya salido bien: si el
      // usuario vuelve con el botón *atrás* del navegador, la pestaña sigue
      // viva y un botón deshabilitado para siempre no se recupera sin un F5.
      cargando.value = false;
    }
  }

  async function accionar(): Promise<void> {
    if (vista.value.estado === "error") return refrescar();
    return conectar();
  }

  if (opciones.auto !== false) onMounted(refrescar);

  return { vista, estado, refrescar, conectar, accionar };
}
