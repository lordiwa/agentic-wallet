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
import type { EstadoVista } from "../lib/gmail-estado";

/**
 * El estado de la conexión, dicho con la etiqueta del sistema (§2.1).
 *
 * Se dibuja siempre, también mientras carga: una tarjeta sin etiqueta y una
 * tarjeta con la etiqueta en "—" ocupan distinto alto, y el salto al llegar la
 * respuesta mueve el botón justo cuando alguien lo va a tocar.
 */
const TONO_A_TAG: Record<EstadoVista, "ok" | "warn" | "bad" | "neu"> = {
  cargando: "neu",
  "sin-configurar": "neu",
  "sin-sesion": "neu",
  desconectado: "warn",
  conectado: "ok",
  reconectar: "warn",
  error: "bad",
};

const ROTULO: Record<EstadoVista, string> = {
  cargando: "leyendo",
  "sin-configurar": "no disponible",
  "sin-sesion": "sin entrar",
  desconectado: "sin conectar",
  conectado: "conectado",
  reconectar: "hay que reconectar",
  error: "error",
};

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
  <section class="card tarjeta" data-testid="conectar-gmail" :data-estado="vista.estado">
    <!-- El estado va en la esquina, como en `c3-tarjeta-overview.html`: la
         etiqueta `.tag` del sistema, no un cartel propio. -->
    <span class="corner"><span class="tag" :class="TONO_A_TAG[vista.estado]">{{ ROTULO[vista.estado] }}</span></span>

    <h3 class="label">Conexión con Gmail</h3>
    <p class="h2 titulo" data-testid="conectar-gmail-titulo">{{ vista.titulo }}</p>
    <p v-if="vista.detalle" class="small detalle" data-testid="conectar-gmail-detalle">{{ vista.detalle }}</p>

    <!-- El aviso de la vuelta de Google es el bloque `.note` del sistema
         (borde izquierdo de 3px), no una píldora: es una explicación de dos
         renglones, y una `.tag` de 20px de radio con texto largo se lee como
         un botón. -->
    <p
      v-if="vista.aviso"
      class="note"
      :class="vista.aviso.tono"
      data-testid="conectar-gmail-aviso"
      role="status"
    >
      {{ vista.aviso.texto }}
    </p>

    <button
      v-if="vista.boton"
      class="btn accion"
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
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  /* Sitio para la etiqueta de la esquina, igual que en `c3`. */
  padding-right: 130px;
}
.corner {
  position: absolute;
  top: 12px;
  right: 14px;
}
.titulo {
  margin: 0;
}
.detalle {
  margin: 0;
}
.accion {
  margin-top: 6px;
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
