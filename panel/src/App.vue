<script setup lang="ts">
/**
 * El andamio del panel: la puerta de N0 y el shell de N2.
 *
 * Dos cosas se deciden acá y en ningún otro lado:
 *
 * 1. **El chip de backend va arriba de todo, también en la pantalla de la
 *    llave** (N0). Un enlace con `?api=` apuntando a un host ajeno tiene que
 *    poder rechazarse ANTES de que alguien escriba su llave, no después.
 * 2. **Sin llave no hay shell.** Si el server pide una y este navegador no la
 *    tiene, no se dibuja una barra lateral con tres pantallas que van a fallar
 *    todas: se pide la llave.
 * 3. **Sin sesión tampoco**, en los builds que traen identidad. La puerta de
 *    Google va ANTES que la de la llave: es la que dice quién sos, y el botón
 *    "Conectar Gmail" no tiene nada que mandar sin ella.
 *
 * Las dos puertas conviven porque son dos despliegues distintos, no dos pasos:
 * el panel local no trae config de Firebase y sólo ve la de la llave; el panel
 * publicado la trae y arranca por la de Google. Ver `auth/config.ts`.
 *
 * El reloj compartido se monta acá, una vez, y lo heredan las pantallas.
 */
import { computed, onMounted, ref } from "vue";
import AccessKeyScreen from "./components/AccessKeyScreen.vue";
import AppShell from "./components/AppShell.vue";
import BackendChip from "./components/BackendChip.vue";
import EntrarConGoogle from "./components/EntrarConGoogle.vue";
import SesionChip from "./components/SesionChip.vue";
import { useSesion } from "./composables/useSesion";
import AltaPerfil from "./views/AltaPerfil.vue";
import Conectado from "./views/Conectado.vue";
import Inicio from "./views/Inicio.vue";
import Movimientos from "./views/Movimientos.vue";
import Preguntas from "./views/Preguntas.vue";
import Resumen from "./views/Resumen.vue";
import { probeHealth } from "./api/client";
import type { DiagnosticoConexion } from "./api/client";
import { provideRefresh } from "./composables/useRefresh";
import { useRuta } from "./router/ruta";

const diagnostico = ref<DiagnosticoConexion | null>(null);
const { ruta } = useRuta();
const sesion = useSesion();

/**
 * "Miro sin entrar": la salida al modo demostración desde la pantalla de login.
 *
 * No se guarda en ningún lado —un F5 vuelve a la puerta— porque no es una
 * preferencia sino una visita: el sitio publicado tiene que seguir mostrando
 * qué es antes de pedirle la cuenta a nadie, y eso no se recuerda.
 */
const mirandoDemo = ref(false);

provideRefresh();

function necesitaLlave(diag: DiagnosticoConexion | null): boolean {
  return diag !== null && (diag.estado === "sin-llave" || diag.estado === "llave-rechazada");
}

/** Mientras la sesión no está resuelta no se dibuja ninguna puerta: un usuario
 * ya entrado vería parpadear el login en cada F5. */
const esperandoSesion = computed(() => sesion.configurado.value && !sesion.listo.value);

const pidiendoSesion = computed(
  () => sesion.configurado.value && sesion.listo.value && sesion.usuario.value === null && !mirandoDemo.value
);

const pidiendoLlave = computed(() => !pidiendoSesion.value && necesitaLlave(diagnostico.value));

onMounted(async () => {
  diagnostico.value = await probeHealth();
});
</script>

<template>
  <!-- La portada institucional va ANTES que las dos puertas y fuera del shell:
       es la pagina publica, la unica que se mira sin haber entrado. Ver
       `views/Inicio.vue`. -->
  <Inicio v-if="ruta.pantalla === 'inicio'" />

  <div v-else-if="esperandoSesion" class="puerta espera" data-testid="app-esperando-sesion">
    <p>Entrando…</p>
  </div>

  <div v-else-if="pidiendoSesion" class="puerta">
    <header class="barra">
      <BackendChip />
    </header>
    <EntrarConGoogle :sesion="sesion" @demo="mirandoDemo = true" />
  </div>

  <div v-else-if="pidiendoLlave" class="puerta">
    <header class="barra">
      <BackendChip />
    </header>
    <AccessKeyScreen @acceso="diagnostico = $event" />
  </div>

  <AppShell v-else :pantalla="ruta.pantalla">
    <template #chip>
      <header class="barra">
        <BackendChip />
        <SesionChip :sesion="sesion" />
      </header>
    </template>

    <Resumen v-if="ruta.pantalla === 'resumen'" />
    <!-- La `key` fuerza a remontar cuando cambia el contexto del destino: entrar
         por el aviso post-sync a la cola acotada al lote (D7-b) estando ya en
         Preguntas tiene que recargar la cola, no dejar la anterior en pantalla. -->
    <Preguntas
      v-else-if="ruta.pantalla === 'preguntas'"
      :key="`${ruta.params.pestana ?? ''}|${ruta.params.ids ?? ''}`"
      :pestana-pedida="ruta.params.pestana"
      :ids="ruta.params.ids"
    />
    <!-- El análisis del historial (N4). No está en la barra a propósito: se
         entra por una tarjeta del Resumen y se sale a la cola. -->
    <AltaPerfil v-else-if="ruta.pantalla === 'alta'" />
    <!-- La vuelta de Google (`RUTA_EXITO` del callback). Tampoco está en la
         barra: no se navega, se aterriza. -->
    <Conectado v-else-if="ruta.pantalla === 'conectado'" />
    <!-- Movimientos (N5). La `key` remonta cuando cambia la categoría: tocar
         otra barra del gráfico estando ya acá tiene que traer la lista de esa
         barra, no dejar la anterior en pantalla. -->
    <Movimientos v-else :key="ruta.params.categoria ?? ''" :categoria="ruta.params.categoria" />
  </AppShell>
</template>

<style scoped>
.puerta {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--fondo);
  color: var(--tinta);
  font: var(--body-size) / 1.5 var(--fuente);
}
.puerta .barra {
  background: var(--panel);
  border-bottom: 1px solid var(--linea);
  padding: 0 26px;
  flex: none;
}
.puerta.espera {
  align-items: center;
  justify-content: center;
  color: var(--apagado);
}
/* Dentro del shell el chip no es una barra del ancho de la ventana: es la
 * primera fila de la columna de contenido. */
.barra {
  border-bottom: 1px solid var(--linea);
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
</style>
