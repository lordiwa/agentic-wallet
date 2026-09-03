<script setup lang="ts">
/**
 * Quién está entrado, y cómo salir.
 *
 * Vive al lado del `BackendChip` y por el mismo motivo que él: las dos cosas
 * que hay que poder ver de un vistazo antes de creerle a un número son a qué
 * backend le está hablando el panel y con qué cuenta. Sin sesión no se dibuja
 * nada — el panel local no tiene identidad y no le sobra lugar para un hueco.
 */
import { computed } from "vue";
import { useSesion, type SesionVista } from "../composables/useSesion";

const props = defineProps<{ sesion?: SesionVista }>();

const sesion = props.sesion ?? useSesion();
const { usuario, salir } = sesion;

/** La dirección si la hay; si no, el nombre. Una cuenta de Google siempre
 * tiene al menos uno de los dos, pero el SDK deja los dos nulables. */
const etiqueta = computed(() => usuario.value?.email ?? usuario.value?.nombre ?? "");
</script>

<template>
  <div v-if="usuario !== null" class="chip" data-testid="sesion-chip">
    <span class="cuenta" :title="etiqueta">{{ etiqueta }}</span>
    <button class="salir" type="button" data-testid="sesion-salir" @click="salir()">Salir</button>
  </div>
</template>

<style scoped>
.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--small-size);
  color: var(--apagado);
  padding: 6px 0;
}
.cuenta {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.salir {
  border: 1px solid var(--boton-secundario-borde);
  background: var(--boton-secundario-bg);
  color: var(--tinta);
  border-radius: var(--radio-boton);
  padding: 4px 10px;
  font: inherit;
  font-size: var(--small-size);
  cursor: pointer;
}
</style>
