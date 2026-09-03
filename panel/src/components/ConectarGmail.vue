<script setup lang="ts">
/**
 * `ConectarGmail` — la tarjeta del consentimiento de Gmail.
 *
 * Como `SyncButton`, este componente **no decide** en qué estado está la
 * conexión: eso es `lib/gmail-estado.ts`, que es una función pura y se prueba
 * sin montar nada. Acá sólo se dibuja.
 *
 * El estado y las acciones llegan por `useGmail()`, que se le puede pasar desde
 * afuera. La vista de `#/conectado` y el Resumen muestran la misma tarjeta con
 * el mismo ciclo, y ninguna de las dos lo reimplementa.
 */
import { useGmail, type Gmail, type OpcionesGmail } from "../composables/useGmail";

const props = defineProps<{
  /** Un ciclo ya armado (lo usan los tests y la vista de la vuelta). Si no
   * viene, la tarjeta arma el suyo. */
  gmail?: Gmail;
  opciones?: OpcionesGmail;
}>();

const gmail = props.gmail ?? useGmail(props.opciones);
const { vista, accionar } = gmail;
</script>

<template>
  <section class="tarjeta" data-testid="conectar-gmail" :data-estado="vista.estado">
    <p v-if="vista.aviso" class="aviso" :class="vista.aviso.tono" data-testid="conectar-gmail-aviso" role="status">
      {{ vista.aviso.texto }}
    </p>

    <h3 class="titulo" data-testid="conectar-gmail-titulo">{{ vista.titulo }}</h3>
    <p v-if="vista.detalle" class="detalle" data-testid="conectar-gmail-detalle">{{ vista.detalle }}</p>

    <button
      v-if="vista.boton"
      class="btn"
      :class="vista.botonClase"
      type="button"
      :disabled="!vista.habilitado"
      data-testid="conectar-gmail-accion"
      @click="accionar()"
    >
      <span v-if="!vista.habilitado" class="spin" aria-hidden="true"></span>
      {{ vista.boton }}
    </button>
  </section>
</template>

<style scoped>
.tarjeta {
  background: var(--panel);
  border: 1px solid var(--linea);
  border-radius: var(--radio-tarjeta);
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
}
.titulo {
  margin: 0;
  font-size: var(--h2-size);
  font-weight: var(--h2-weight);
  color: var(--tinta);
}
.detalle {
  margin: 0;
  font-size: var(--small-size);
  color: var(--apagado);
}
.aviso {
  margin: 0 0 4px;
  align-self: stretch;
  padding: 8px 10px;
  border-radius: var(--radio-etiqueta);
  border: 1px solid transparent;
  font-size: var(--small-size);
}
.aviso.ok {
  background: var(--tag-ok-bg);
  border-color: var(--tag-ok-borde);
  color: var(--tag-ok-texto);
}
.aviso.warn {
  background: var(--tag-warn-bg);
  border-color: var(--tag-warn-borde);
  color: var(--tag-warn-texto);
}
.aviso.bad {
  background: var(--tag-bad-bg);
  border-color: var(--tag-bad-borde);
  color: var(--tag-bad-texto);
}
.btn {
  margin-top: 4px;
  padding: 9px 16px;
  border-radius: var(--radio-boton);
  border: 1px solid transparent;
  font: inherit;
  font-size: var(--body-size);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.btn.primario {
  background: var(--boton-primario-bg);
  color: var(--boton-primario-texto);
}
.btn.secundario {
  background: var(--boton-secundario-bg);
  border-color: var(--boton-secundario-borde);
  color: var(--tinta);
}
.btn:disabled {
  background: var(--boton-off-bg);
  color: var(--boton-off-texto);
  border-color: transparent;
  cursor: default;
}
.spin {
  width: 12px;
  height: 12px;
  border: 2px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: girar 0.8s linear infinite;
}
@keyframes girar {
  to {
    transform: rotate(360deg);
  }
}
/* Quien pidió menos movimiento no necesita un anillo girando para entender que
 * algo está en curso: el botón deshabilitado ya lo dice. */
@media (prefers-reduced-motion: reduce) {
  .spin {
    animation: none;
  }
}
</style>
