<script setup lang="ts">
/**
 * El chip de backend: **siempre visible**, en la barra.
 *
 * Hereda del bloque "Conexiones" de `p10-configuracion.html` del design
 * system — la fila `.conn` (etiqueta `.tag` + texto + accion terciaria),
 * comprimida a una linea. Ni un color propio: todo sale de tokens.css.
 *
 * Existe porque la pregunta "¿a que server le esta hablando este navegador?"
 * hoy no se puede contestar mirando la pantalla, y con `?api=` la respuesta
 * cambia con un enlace. El chip la contesta sin que haya que ir a buscarla, y
 * *Probar conexion* traduce el error de red a uno de los seis estados que el
 * motor sabe distinguir (R27).
 */
import { computed, onMounted, ref } from "vue";
import {
  confirmPendingApiBase,
  currentBackendVerdict,
  dismissPendingApiBase,
  getApiBase,
  pendingApiBase,
} from "../api/base";
import { etiquetaBackend, explicarEstado, probeHealth, tagDeEstado } from "../api/client";
import type { DiagnosticoConexion } from "../api/client";
import { DEMO_BASE, mayReceiveCredential } from "../api/origins";

const diagnostico = ref<DiagnosticoConexion | null>(null);
const probando = ref(false);
const base = ref(getApiBase());
const propuesta = ref<string | null>(pendingApiBase());

const tag = computed(() => tagDeEstado(diagnostico.value?.estado ?? null));
const servidor = computed(() => etiquetaBackend(base.value));
const explicacion = computed(() =>
  diagnostico.value === null
    ? "Todavía no se probó esta conexión."
    : explicarEstado(diagnostico.value)
);
/** Un backend que no recibe la llave —ni por estar fuera de la lista blanca ni
 * porque el usuario se la nego a mano (W27)— lo dice, aunque la conexion
 * todavia no se haya probado. */
const ajeno = computed(() => !mayReceiveCredential(currentBackendVerdict(base.value)));

/** El texto de la propuesta pendiente: `?api=` vacio significa "volvé al
 * mismo origen", que es una propuesta como cualquier otra. */
const propuestaTexto = computed(() => {
  if (propuesta.value === "") return "este mismo servidor";
  // `etiquetaBackend` dice "sin servidor" para la base demo, que en el chip va
  // al lado de la etiqueta "Demostración" y se entiende. Acá va solo, en un
  // cartel que pide confirmar un cambio, y "sin servidor" no dice lo único que
  // importa: que los números van a ser inventados (wargaming ronda 3, W25).
  if (propuesta.value === DEMO_BASE) return "el modo demostración — datos inventados, no tu ledger";
  return etiquetaBackend(propuesta.value ?? "");
});

async function probar(): Promise<void> {
  probando.value = true;
  try {
    diagnostico.value = await probeHealth();
  } finally {
    probando.value = false;
  }
}

/** El unico camino por el que un `?api=` de un enlace llega a guardarse (R1).
 * Guardar el backend NO le da la llave: eso es `trust`, y es otro boton. */
function aceptarPropuesta(trust: boolean): void {
  confirmPendingApiBase({ trust });
  base.value = getApiBase();
  propuesta.value = null;
  dismissPendingApiBase();
  diagnostico.value = null;
}

function rechazarPropuesta(): void {
  propuesta.value = null;
  dismissPendingApiBase();
}

onMounted(() => {
  void probar();
});
</script>

<template>
  <div class="wrap">
    <div class="conn" data-testid="backend-chip">
      <span class="tag" :class="tag.clase" data-testid="backend-chip-tag">{{ tag.texto }}</span>
      <span class="t">
        <b data-testid="backend-chip-servidor">{{ servidor }}</b>
        <span data-testid="backend-chip-explicacion">{{ explicacion }}</span>
      </span>
      <span v-if="ajeno" class="tag neu" data-testid="backend-chip-sin-credencial">Sin credencial</span>
      <button class="btn qui" type="button" :disabled="probando" @click="probar">
        {{ probando ? "Probando…" : "Probar conexión" }}
      </button>
    </div>

    <div v-if="propuesta !== null" class="note" data-testid="backend-chip-propuesta">
      <b>Este enlace quiere cambiar tu backend</b> a
      <code>{{ propuestaTexto }}</code
      >. No se guardó nada todavía.
      <div class="acciones">
        <button class="btn" type="button" @click="aceptarPropuesta(false)">Guardar sin darle la llave</button>
        <button class="btn pri" type="button" @click="aceptarPropuesta(true)">Guardar y autorizar</button>
        <button class="btn qui" type="button" @click="rechazarPropuesta">Descartar</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  font-family: var(--fuente);
  color: var(--tinta);
}
.conn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 0;
}
.conn .t {
  flex: 1;
  min-width: 0;
}
.conn .t b {
  font-size: 13.5px;
  display: block;
  font-weight: 600;
}
.conn .t span {
  font-size: var(--small-size);
  color: var(--apagado);
}
.tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--label-size);
  font-weight: 600;
  border-radius: var(--radio-etiqueta);
  padding: 1px 8px;
  border: 1px solid;
  white-space: nowrap;
}
.tag.ok {
  background: var(--tag-ok-bg);
  border-color: var(--tag-ok-borde);
  color: var(--tag-ok-texto);
}
.tag.warn {
  background: var(--tag-warn-bg);
  border-color: var(--tag-warn-borde);
  color: var(--tag-warn-texto);
}
.tag.bad {
  background: var(--tag-bad-bg);
  border-color: var(--tag-bad-borde);
  color: var(--tag-bad-texto);
}
.tag.neu {
  background: var(--tag-neu-bg);
  border-color: var(--tag-neu-borde);
  color: var(--tag-neu-texto);
}
.btn {
  border: 1px solid var(--boton-secundario-borde);
  background: var(--boton-secundario-bg);
  color: var(--tinta);
  border-radius: var(--radio-boton);
  padding: 7px 13px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.btn.pri {
  background: var(--boton-primario-bg);
  /* El primario del tema oscuro sí lleva borde propio, más claro que su fondo:
     sin él el botón no se recorta contra la nota que lo contiene. */
  border-color: var(--boton-primario-borde);
  color: var(--boton-primario-texto);
  font-weight: 600;
}
.btn.qui {
  border-color: transparent;
  color: var(--boton-terciario-texto);
}
.btn:disabled {
  background: var(--boton-off-bg);
  border-color: var(--boton-off-bg);
  color: var(--boton-off-texto);
  cursor: default;
}
.note {
  border-left: 3px solid var(--atencion);
  background: var(--nota-bg);
  padding: 10px 12px;
  font-size: var(--small-size);
  color: var(--texto-nota);
  margin-top: 4px;
}
.acciones {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 9px;
}
/* `code` no se redefine acá: la regla de base.css es idéntica a la de la
   tarjeta, y una copia local sólo sirve para quedarse vieja. */
</style>
