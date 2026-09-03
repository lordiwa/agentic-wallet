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
/** Un backend fuera de la lista blanca no recibe la llave, y eso se dice
 * aunque la conexion todavia no se haya probado. */
const ajeno = computed(() => currentBackendVerdict(base.value) === "foreign");

/** El texto de la propuesta pendiente: `?api=` vacio significa "volvé al
 * mismo origen", que es una propuesta como cualquier otra. */
const propuestaTexto = computed(() =>
  propuesta.value === "" ? "este mismo servidor" : etiquetaBackend(propuesta.value ?? "")
);

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
  border-color: var(--boton-primario-bg);
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
  border-radius: 0 var(--radio-boton) var(--radio-boton) 0;
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
code {
  font-family: var(--fuente-mono);
  font-size: 12px;
  background: var(--superficie-suave);
  border-radius: 4px;
  padding: 1px 5px;
}
</style>
