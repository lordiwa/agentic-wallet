<script setup lang="ts">
/**
 * El andamio minimo de la fase N0. **No es el shell del panel** — la barra
 * lateral, la navegacion y el Resumen son N2 (`p2-resumen.html`). Acá sólo
 * vive lo que N0 entrega: la barra con el chip de backend, siempre visible, y
 * la pantalla de la llave cuando el server pide una que este navegador no
 * tiene.
 *
 * El chip va **arriba de todo, tambien en la pantalla de la llave**, y eso es
 * deliberado: un enlace con `?api=` apuntando a un host ajeno tiene que poder
 * rechazarse ANTES de que alguien escriba su llave, no despues.
 */
import { onMounted, ref } from "vue";
import AccessKeyScreen from "./components/AccessKeyScreen.vue";
import BackendChip from "./components/BackendChip.vue";
import { probeHealth } from "./api/client";
import type { DiagnosticoConexion } from "./api/client";

const diagnostico = ref<DiagnosticoConexion | null>(null);

function necesitaLlave(diag: DiagnosticoConexion | null): boolean {
  return diag !== null && (diag.estado === "sin-llave" || diag.estado === "llave-rechazada");
}

onMounted(async () => {
  diagnostico.value = await probeHealth();
});
</script>

<template>
  <div class="app">
    <header class="barra">
      <BackendChip />
    </header>
    <AccessKeyScreen v-if="necesitaLlave(diagnostico)" @acceso="diagnostico = $event" />
    <main v-else class="vista">
      <h1>Panel</h1>
      <p class="sub">
        La fase N0 entrega la puerta: la llave del server y el chip de backend. El Resumen, las
        Preguntas y los Movimientos llegan en las fases siguientes.
      </p>
    </main>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--fondo);
  color: var(--tinta);
  font: var(--body-size) / 1.5 var(--fuente);
}
.barra {
  background: var(--panel);
  border-bottom: 1px solid var(--linea);
  padding: 0 26px;
  flex: none;
}
.vista {
  padding: var(--shell-padding);
}
h1 {
  font-size: var(--h1-size);
  font-weight: var(--h1-weight);
  letter-spacing: var(--h1-tracking);
  margin: 0 0 3px;
}
.sub {
  color: var(--apagado);
  font-size: 13px;
  margin: 0;
  max-width: 52em;
}
</style>
