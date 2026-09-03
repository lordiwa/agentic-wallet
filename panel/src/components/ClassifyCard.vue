<script setup lang="ts">
/**
 * `ClassifyCard` — la tarjeta de una contraparte de la cola.
 *
 * **No existe en el design system y se crea siguiendo el mismo sistema**
 * (§2.4 del plan): hereda el armazón de `c2-tarjeta-revision.html` —cabecera de
 * color con el nombre y la etiqueta, cuerpo, fila de acciones separada por una
 * línea— y el selector de categoría de `p6-reglas.html`. Sin colores,
 * tipografías ni radios nuevos: todo sale de `styles/tokens.css`.
 *
 * Lo que agrega sobre `c2`, y por qué cada cosa:
 *
 * - **El conteo de movimientos, la plata y los meses.** La pregunta no es sobre
 *   una fila: es sobre una contraparte con 6 movimientos en 3 meses. Sin esos
 *   tres números la pregunta es "¿qué es este nombre?", que nadie puede
 *   responder bien.
 * - **La plata, en grande y tabular.** Es el orden de la cola y el criterio de
 *   terminado (M1): tiene que verse por qué esta tarjeta está primera.
 * - **`Saltar` y `No preguntarme más`.** La primera manda la tarjeta al final y
 *   no escribe nada; la segunda es M5 y sí escribe.
 *
 * **Lo que NO tiene, a propósito:** el paso "hay 6 más de esta persona, ¿son
 * todos salud?". Preguntando por contraparte esa pregunta no existe — la
 * respuesta ya vale para los 6, porque lo que se escribe es una regla sobre el
 * nombre, no una etiqueta sobre una fila. Era una pregunta sobre la mecánica
 * interna del motor, no sobre la plata.
 *
 * La tarjeta **no calcula nada**: `count`, `total` y `months` llegan del motor.
 */
import { computed, ref } from "vue";
import type { Category, ClassifyGroupRow } from "../api/types";
import { nombreCategoria } from "../lib/categorias";
import { formatoEntero, formatoPlata, plural } from "../lib/formato";
import { timeAgo } from "../lib/freshness";

const props = withDefaults(
  defineProps<{
    grupo: ClassifyGroupRow;
    /** Su lugar en la cola, para "3 de 151" como en `c2`. */
    posicion: number;
    total: number;
    /** Cuántos movimientos de esta MISMA contraparte están esperando que se
     * confirme su monto. Mayor que cero cambia el texto: el monto va primero. */
    montosPendientes?: number;
    /** Esta tarjeta ya fue salteada y está al final de la cola. */
    salteada?: boolean;
    /** Hay una escritura en vuelo: los botones no se pulsan dos veces. */
    ocupada?: boolean;
  }>(),
  { montosPendientes: 0, salteada: false, ocupada: false }
);

const emit = defineEmits<{
  clasificar: [category: Category];
  saltar: [];
  silenciar: [];
}>();

/**
 * Las categorías que se pueden elegir. Es el glosario cerrado del motor
 * (`category/categorize.ts`) menos sus dos fallbacks: `otros` y
 * `transferencia_persona` son *"no sé"* y *"es una transferencia con
 * contraparte"*, que es exactamente el estado del que esta tarjeta existe para
 * salir. Ofrecerlos sería ofrecer "responder que no sabés", y la salida honesta
 * para eso ya está: se llama *No preguntarme más* (M5).
 */
const CATEGORIAS: Category[] = [
  "comida",
  "transporte",
  "salud",
  "mascota",
  "servicios",
  "recarga",
  "efectivo",
  "suscripcion",
];

const elegida = ref<Category | "">("");

const opciones = computed(() => CATEGORIAS.map((clave) => ({ clave, nombre: nombreCategoria(clave) })));

const resumenLinea = computed(() => {
  const partes = [
    plural(props.grupo.count, "movimiento", "movimientos"),
    `en ${plural(props.grupo.months, "mes", "meses")}`,
  ];
  const visto = timeAgo(props.grupo.last_ts);
  if (visto) partes.push(`el último ${visto}`);
  return partes.join(" · ");
});

function responder(): void {
  if (elegida.value === "") return;
  emit("clasificar", elegida.value);
}
</script>

<template>
  <div class="cc" :class="{ salteada }" data-testid="classify-card">
    <div class="cc-h">
      <b data-testid="classify-contraparte">{{ grupo.counterparty }}</b>
      <span class="cc-h-der">
        <span v-if="salteada" class="tag neu" data-testid="classify-salteada">salteada</span>
        <span class="tag acc">{{ nombreCategoria(grupo.category) }}</span>
        <span class="small tabular">{{ formatoEntero(posicion) }} de {{ formatoEntero(total) }}</span>
      </span>
    </div>

    <div class="cc-b">
      <div class="cifras">
        <div>
          <h3 class="label">Plata que mueve</h3>
          <span class="num" data-testid="classify-total">{{ formatoPlata(grupo.total) }}</span>
          <span class="small">{{ resumenLinea }}</span>
        </div>
      </div>

      <!-- Orden entre pestañas: sin monto afirmado la fila no entra a ningún
           total, así que su categoría no movería ningún gráfico. -->
      <p v-if="montosPendientes > 0" class="aviso" data-testid="classify-monto-primero">
        Esta contraparte tiene además
        {{ plural(montosPendientes, "movimiento esperando", "movimientos esperando") }} que confirmes su monto. Eso se
        pregunta en la pestaña <b>Monto</b>, y va primero: mientras el monto no está afirmado esa plata no entra a
        ningún total, así que no está contada acá arriba.
      </p>

      <div class="acts">
        <label class="sr" :for="`cat-${grupo.pattern}`">Categoría para {{ grupo.counterparty }}</label>
        <select
          :id="`cat-${grupo.pattern}`"
          v-model="elegida"
          class="inp"
          :disabled="ocupada"
          data-testid="classify-selector"
        >
          <option value="" disabled>Elegí qué es</option>
          <option v-for="opcion in opciones" :key="opcion.clave" :value="opcion.clave">{{ opcion.nombre }}</option>
        </select>
        <button
          class="btn pri"
          type="button"
          :disabled="elegida === '' || ocupada"
          data-testid="classify-responder"
          @click="responder"
        >
          Es esto
        </button>
        <button class="btn" type="button" :disabled="ocupada" data-testid="classify-saltar" @click="emit('saltar')">
          Saltar
        </button>
        <button
          class="btn qui"
          type="button"
          :disabled="ocupada"
          data-testid="classify-silenciar"
          @click="emit('silenciar')"
        >
          No preguntarme más por esta
        </button>
      </div>

      <p class="small pie">
        Tu respuesta escribe una regla sobre este nombre y vale para
        {{ plural(grupo.count, "el movimiento", "los movimientos") }} de esta contraparte, los de antes y los que
        vengan. No hay una segunda pregunta.
      </p>
    </div>
  </div>
</template>

<style scoped>
/* El armazón de `c2-tarjeta-revision.html`: borde de color, cabecera teñida,
 * cuerpo con padding. Acá el color es el neutro del sistema y no el de
 * atención: esta tarjeta no es una anomalía del motor, es una pregunta. */
.cc {
  border: 1px solid var(--linea);
  border-radius: var(--radio-tarjeta);
  background: var(--panel);
  overflow: hidden;
  margin-bottom: 12px;
}
.cc.salteada {
  opacity: 0.72;
}
.cc-h {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  background: var(--superficie-suave);
  padding: 9px 15px;
  border-bottom: 1px solid var(--linea);
}
.cc-h b {
  font-size: 13.5px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.cc-h-der {
  display: flex;
  gap: 7px;
  align-items: center;
  flex: none;
}
.cc-b {
  padding: 14px 15px;
}
.cifras {
  margin-bottom: 12px;
}
.cifras .small {
  display: block;
}
/* La nota del sistema (`.note` de `c2`): barra de atención a la izquierda. */
.aviso {
  border-left: 3px solid var(--atencion);
  background: var(--nota-bg);
  padding: 10px 12px;
  border-radius: 0 var(--radio-boton) var(--radio-boton) 0;
  font-size: var(--small-size);
  color: var(--texto-nota);
  margin: 0 0 12px;
}
.acts {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding-top: 13px;
  border-top: 1px solid var(--superficie-suave);
}
/* El selector de `p6-reglas.html`, con el radio de control del sistema. */
.inp {
  border: 1px solid var(--linea);
  background: var(--panel);
  color: var(--tinta);
  border-radius: var(--radio-control);
  padding: 7px 11px;
  font: inherit;
  font-size: 13px;
  min-width: 176px;
}
.inp:disabled {
  background: var(--boton-off-bg);
  color: var(--boton-off-texto);
}
.pie {
  margin: 10px 0 0;
}
/* Etiqueta para lectores de pantalla: el `select` necesita nombre, y la
 * pantalla ya dice de quién se habla en la cabecera. */
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 560px) {
  .cc-h {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
  .acts {
    flex-direction: column;
    align-items: stretch;
  }
  .inp {
    min-width: 0;
  }
}
</style>
