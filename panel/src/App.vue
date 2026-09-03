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
 *
 * El reloj compartido se monta acá, una vez, y lo heredan las pantallas.
 */
import { computed, onMounted, ref } from "vue";
import AccessKeyScreen from "./components/AccessKeyScreen.vue";
import AppShell from "./components/AppShell.vue";
import BackendChip from "./components/BackendChip.vue";
import AltaPerfil from "./views/AltaPerfil.vue";
import Pendiente from "./views/Pendiente.vue";
import Preguntas from "./views/Preguntas.vue";
import Resumen from "./views/Resumen.vue";
import { probeHealth } from "./api/client";
import type { DiagnosticoConexion } from "./api/client";
import { provideRefresh } from "./composables/useRefresh";
import { useRuta } from "./router/ruta";

const diagnostico = ref<DiagnosticoConexion | null>(null);
const { ruta } = useRuta();

provideRefresh();

function necesitaLlave(diag: DiagnosticoConexion | null): boolean {
  return diag !== null && (diag.estado === "sin-llave" || diag.estado === "llave-rechazada");
}

const pidiendoLlave = computed(() => necesitaLlave(diagnostico.value));

onMounted(async () => {
  diagnostico.value = await probeHealth();
});
</script>

<template>
  <div v-if="pidiendoLlave" class="puerta">
    <header class="barra">
      <BackendChip />
    </header>
    <AccessKeyScreen @acceso="diagnostico = $event" />
  </div>

  <AppShell v-else :pantalla="ruta.pantalla">
    <template #chip>
      <header class="barra">
        <BackendChip />
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
    <Pendiente
      v-else
      titulo="Movimientos"
      fase="N5"
      que="Todo lo que el ledger tiene, con dos filtros y sin paginador."
    />
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
/* Dentro del shell el chip no es una barra del ancho de la ventana: es la
 * primera fila de la columna de contenido. */
.barra {
  border-bottom: 1px solid var(--linea);
  margin-bottom: 14px;
}
</style>
