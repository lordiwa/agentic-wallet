<script setup lang="ts">
/**
 * `SyncButton` — réplica de `c1-boton-sync.html`, con **la barra de progreso y
 * el botón *Seguir* de `p3-sincronizacion.html` adentro**.
 *
 * La pantalla P3 no se construye, y esa es la decisión de fondo de N2: el ciclo
 * entero del sync —disparar, ver el avance, *Seguir*, terminar— cabe acá. Lo
 * único que P3 agregaba era el registro de lotes (que no se persiste:
 * `sync_progress` es una fila única) y *Detener* (que no detiene: el runner
 * escribe el progreso una vez por lote, al final).
 *
 * Este componente **no decide** en qué estado está el sync: eso es
 * `lib/sync-estado.ts`, que es una función pura y se prueba sin montar nada.
 * Acá sólo se dibuja, y se avisa hacia afuera cuando el usuario pulsa.
 *
 * Sin auto-encadenado. Con un backlog de miles de correos, encadenar llamadas
 * solo hasta terminar sería el único bucle de requests sin supervisión del
 * panel: *Seguir* es un botón, y lo pulsa una persona.
 */
import { computed } from "vue";
import { vistaSync, type EntradaSync } from "../lib/sync-estado";

const props = defineProps<{ entrada: EntradaSync; ahora?: Date }>();
const emit = defineEmits<{ (e: "sincronizar"): void }>();

const vista = computed(() => vistaSync(props.entrada, props.ahora ?? new Date()));
</script>

<template>
  <div class="unit" data-testid="sync-button" :data-estado="vista.estado">
    <button
      class="btn"
      :class="vista.botonClase"
      type="button"
      :disabled="!vista.habilitado"
      data-testid="sync-button-accion"
      @click="emit('sincronizar')"
    >
      <span v-if="vista.estado === 'corriendo' && !vista.habilitado" class="spin" aria-hidden="true"></span>
      {{ vista.boton }}
    </button>

    <div class="meta-col">
      <span class="meta" :class="vista.metaClase">
        <b data-testid="sync-button-titulo">{{ vista.titulo }}</b>
        <span v-if="vista.detalle" data-testid="sync-button-detalle">{{ vista.detalle }}</span>
      </span>

      <!-- La barra viene de `p3-sincronizacion.html` y vive acá adentro. -->
      <template v-if="vista.progreso">
        <span class="track">
          <i
            class="fill"
            :class="{ warn: vista.estado === 'corriendo' && vista.habilitado }"
            :style="{ width: `${vista.progreso.porcentaje}%` }"
          ></i>
        </span>
        <span class="meta tabular" data-testid="sync-button-progreso">{{ vista.progreso.texto }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.unit {
  display: flex;
  align-items: center;
  gap: 11px;
  flex-wrap: wrap;
}
.meta-col {
  flex: 1;
  min-width: 150px;
}
.meta {
  font-size: var(--small-size);
  color: var(--apagado);
  line-height: 1.4;
  display: block;
}
.meta b {
  color: var(--tinta);
  font-weight: 600;
  display: block;
  font-size: 13px;
}
.meta.warn b {
  color: var(--tag-warn-texto);
}
.meta.bad b {
  color: var(--falla);
}
.meta.ok b {
  color: var(--al-dia);
}
.track {
  margin: 6px 0 4px;
}
/* El anillo que gira de `c1`, con los colores de la etiqueta `acc`. */
.spin {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 2px solid var(--tag-acc-borde);
  border-top-color: var(--accion);
  flex: none;
  display: inline-block;
  animation: gira 0.9s linear infinite;
}
@keyframes gira {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
</style>
