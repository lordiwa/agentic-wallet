<script setup lang="ts">
/**
 * `RecurringCard` — una propuesta de gasto fijo, leída del historial (H30).
 *
 * **No existe en el design system y se crea siguiendo el mismo sistema**
 * (§2.4): hereda la fila de propuesta de `p1-alta-perfil.html` —el bloque
 * `.sug` azul con su etiqueta *"leído de tu historial"*— y el selector de
 * categoría de `p6-reglas.html`, que es el mismo que ya usa `ClassifyCard`. Sin
 * colores, tipografías ni radios nuevos: todo sale de `styles/tokens.css`.
 *
 * Lo que agrega sobre la fila de `p1`, y por qué:
 *
 * - **El tamaño de la muestra, al lado de la cifra y no en una nota al pie.**
 *   `p1` dibuja "Sueldo estimado — —" y nada más. Sobre el ledger real sólo 2
 *   contrapartes aparecen en 6 meses o más (riesgo 3 del plan): una mediana sin
 *   su muestra promete un patrón que los datos no sostienen. Acá la muestra es
 *   parte de la propuesta, no una aclaración.
 * - **El día típico.** Un gasto fijo sin su día no sirve para un calendario, y
 *   el calendario es la mitad de para qué existe saber cuáles son.
 * - **Confirmar y descartar, ítem por ítem.** `p1` tiene un *"Aceptar y
 *   precargar"* que acepta todo junto; acá cada propuesta se confirma o se
 *   descarta sola. Es la regla 3 del CLAUDE.md: nada se guarda sin confirmación
 *   explícita, y "explícita" sobre diez cosas a la vez no lo es.
 *
 * **Qué es confirmar.** Escribir **una regla de categoría** sobre este nombre,
 * con el mismo escritor de la cola (`POST /api/classify`, M4) — no se persiste
 * una "lista de gastos fijos" (H31), porque no hace falta: la regla es lo que
 * hace que el gasto quede clasificado para siempre, hacia atrás y hacia
 * adelante. Descartar **no escribe nada**: la propuesta se va de esta pantalla y
 * la contraparte sigue en la cola, con su pregunta intacta.
 *
 * La tarjeta **no calcula nada**: la mediana, el día típico y la muestra llegan
 * del motor.
 */
import { computed, ref } from "vue";
import type { Category, RecurringProposalRow } from "../api/types";
import { opcionesDeCategoria } from "../lib/categorias";
import { formatoEntero, formatoPlata, plural } from "../lib/formato";
import { timeAgo } from "../lib/freshness";

const props = withDefaults(
  defineProps<{
    propuesta: RecurringProposalRow;
    /** Su lugar en la lista, para "3 de 10". */
    posicion: number;
    total: number;
    /** Hay una escritura en vuelo: los botones no se pulsan dos veces. */
    ocupada?: boolean;
  }>(),
  { ocupada: false }
);

const emit = defineEmits<{
  confirmar: [category: Category];
  descartar: [];
}>();

const elegida = ref<Category | "">("");
const opciones = computed(() => opcionesDeCategoria());

/**
 * La muestra, dicha en voz alta. Se escribe entera aunque sea larga: es la
 * diferencia entre "tu gasto fijo es 20" y "vi 20 en cuatro meses distintos",
 * y sólo la segunda es verdad.
 */
const muestra = computed(() => {
  const partes = [
    `visto en ${plural(props.propuesta.sample_size, "mes", "meses")} distintos`,
    plural(props.propuesta.count, "movimiento", "movimientos"),
  ];
  const visto = timeAgo(props.propuesta.last_ts);
  if (visto) partes.push(`el último ${visto}`);
  return partes.join(" · ");
});

const diaTipico = computed(() => `suele caer el ${formatoEntero(props.propuesta.dia_tipico)} de cada mes`);

function confirmar(): void {
  if (elegida.value === "") return;
  emit("confirmar", elegida.value);
}
</script>

<template>
  <div class="rc" data-testid="recurring-card">
    <div class="rc-h">
      <b data-testid="recurring-contraparte">{{ propuesta.counterparty }}</b>
      <span class="rc-h-der">
        <span class="tag neu">leído de tu historial</span>
        <span class="small tabular">{{ formatoEntero(posicion) }} de {{ formatoEntero(total) }}</span>
      </span>
    </div>

    <div class="rc-b">
      <div class="cifras">
        <div>
          <h3 class="label">Suele salir por mes</h3>
          <span class="num" data-testid="recurring-monto">{{ formatoPlata(propuesta.monto_estimado) }}</span>
          <!-- La mediana y su muestra van juntas, siempre. -->
          <span class="small" data-testid="recurring-muestra">mediana · {{ muestra }}</span>
        </div>
        <div class="der">
          <h3 class="label">Día típico</h3>
          <span class="dia tabular" data-testid="recurring-dia">{{ diaTipico }}</span>
          <span class="small">en total movió {{ formatoPlata(propuesta.total) }}</span>
        </div>
      </div>

      <div class="acts">
        <label class="sr" :for="`fijo-${propuesta.pattern}`">Categoría para {{ propuesta.counterparty }}</label>
        <select
          :id="`fijo-${propuesta.pattern}`"
          v-model="elegida"
          class="inp"
          :disabled="ocupada"
          data-testid="recurring-selector"
        >
          <option value="" disabled>Elegí qué es</option>
          <option v-for="opcion in opciones" :key="opcion.clave" :value="opcion.clave">{{ opcion.nombre }}</option>
        </select>
        <button
          class="btn pri"
          type="button"
          :disabled="elegida === '' || ocupada"
          data-testid="recurring-confirmar"
          @click="confirmar"
        >
          Confirmar
        </button>
        <button
          class="btn qui"
          type="button"
          :disabled="ocupada"
          data-testid="recurring-descartar"
          @click="emit('descartar')"
        >
          No es un gasto fijo
        </button>
      </div>

      <p class="small pie">
        Confirmar escribe una regla sobre este nombre y vale para
        {{ plural(propuesta.count, "el movimiento", "los movimientos") }} de esta contraparte, los de antes y los que
        vengan. Descartar no guarda nada.
      </p>
    </div>
  </div>
</template>

<style scoped>
/* El bloque `.sug` de `p1-alta-perfil.html`: borde y fondo del acento, que es
 * lo que en el sistema significa "esto lo propuso el agente, todavía no es
 * tuyo". Cuando el usuario confirma, la propuesta desaparece — no cambia de
 * color: dejar de ser una propuesta es dejar de estar. */
.rc {
  border: 1px solid var(--tag-acc-borde);
  border-radius: var(--radio-tarjeta);
  background: var(--tag-acc-bg);
  overflow: hidden;
  margin-bottom: 12px;
}
.rc-h {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 9px 15px;
  border-bottom: 1px solid var(--tag-acc-borde);
}
.rc-h b {
  font-size: 13.5px;
  min-width: 0;
  overflow-wrap: anywhere;
}
.rc-h-der {
  display: flex;
  gap: 7px;
  align-items: center;
  flex: none;
}
/* El cuerpo vuelve al blanco de tarjeta: la propuesta se enmarca en el acento,
 * pero los números se leen sobre el lienzo del sistema. */
.rc-b {
  padding: 14px 15px;
  background: var(--panel);
}
.cifras {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 12px;
}
.cifras .small {
  display: block;
}
.der {
  text-align: right;
  flex: none;
}
.dia {
  display: block;
  font-size: 13.5px;
  margin: 2px 0 1px;
}
.acts {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding-top: 13px;
  border-top: 1px solid var(--superficie-suave);
}
/* El selector de `p6-reglas.html`, idéntico al de `ClassifyCard`. */
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
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 560px) {
  .rc-h {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }
  .cifras {
    flex-direction: column;
    gap: 10px;
  }
  .der {
    text-align: left;
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
