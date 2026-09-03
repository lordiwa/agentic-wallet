<script setup lang="ts">
/**
 * `ReviewCard` — réplica de `c2-tarjeta-revision.html` (y de la tarjeta de
 * `p5-revision.html`, que es la misma pieza) **en su versión honesta**.
 *
 * Qué se elimina del dibujo original, y por qué. §2.5 pide que la diferencia
 * esté escrita, y las dos son recortes por falta de dato, no de estilo:
 *
 * - **El panel "Lo que leyó Claude"** (H10). El sistema dibuja tres columnas:
 *   parser, Claude y ledger. Sobre ocho meses de datos reales hubo **cero**
 *   discrepancias entre las dos lecturas, y —más definitivo— el motor no
 *   persiste la lectura de Claude en ningún lado: no hay columna que leer. Una
 *   pieza que dibuja una comparación sin tener el segundo término inventa la
 *   mitad de lo que muestra.
 * - **La línea de motivo** (H9). `p5` muestra "cayó acá porque el parser y
 *   Claude no coincidieron". El motivo tampoco se persiste
 *   (`review_reason` no existe en `db/schema.ts`), así que la tarjeta diría
 *   siempre el mismo motivo para todas las filas, fuera cierto o no.
 *
 * Queda lo que el motor sí puede contestar: **contraparte, monto del ledger,
 * asunto del correo y las tres acciones**.
 *
 * Dos reglas del sistema que esta tarjeta cumple sin excepción:
 *
 * 1. **R12 — la tarjeta dice qué hace cada acción con el total**, y lo dice
 *    antes de que se toque el botón. Descartar escribe `is_discarded = 1` y
 *    `strategy/totals.ts` excluye esa fila para siempre: descartar **no mueve
 *    el saldo**, y ésa es la frase que tiene que estar a la vista.
 * 2. **R14 — una fila en otra moneda no ofrece Confirmar.** El motor lo
 *    rechaza (`resolve.ts`) porque los totales suman `amount` sin convertir, y
 *    un `confirm` metería el número crudo como si fuera moneda base. El botón
 *    queda deshabilitado **con su motivo al lado**, no simplemente apagado: un
 *    botón gris sin explicación es un callejón.
 *
 * Cero es un monto válido y se dibuja como cifra (regla 4 de CLAUDE.md); lo que
 * falta acá no es el monto, es la confirmación — por eso la etiqueta es
 * *Sin confirmar* y no *Sin leer* (R6/X8/X11).
 */
import { computed, ref } from "vue";
import type { TransactionRow } from "../api/types";
import { QUE_HACE_CADA_ACCION } from "../lib/efecto";
import { ROTULO_SIN_CONFIRMAR, formatoEntero, formatoFecha, formatoPlata, parsePlata } from "../lib/formato";

const props = withDefaults(
  defineProps<{
    fila: TransactionRow;
    posicion: number;
    total: number;
    /**
     * La moneda del perfil, si el panel la conoce (`overview.balance.currency`).
     * `null` es "no sé": entonces **no se deshabilita nada** y la última palabra
     * la tiene el motor, que devuelve `foreign_currency` y la pantalla lo
     * muestra con su motivo. Apagar un botón por una sospecha sería peor que
     * dejar que el motor conteste.
     */
    monedaPerfil?: string | null;
    ocupada?: boolean;
  }>(),
  { monedaPerfil: null, ocupada: false }
);

const emit = defineEmits<{
  confirmar: [];
  corregir: [amount: number];
  descartar: [];
}>();

const correccion = ref("");

/** R14. Sin moneda de perfil conocida no se afirma nada. */
const otraMoneda = computed(
  () => props.monedaPerfil !== null && props.monedaPerfil !== "" && props.fila.currency !== props.monedaPerfil
);

/**
 * El monto tecleado, sólo si es un número que una persona puede afirmar.
 * **Cero es válido** — lo desconocido nunca llega por este campo.
 *
 * Se lee con `parsePlata`, el mismo lector que el resto del panel, y no con
 * `Number()` (wargaming ronda 3, W16). Éste era el último campo con el código
 * que W3 declaró insuficiente y W10 reemplazó: leía "1.500" —la cifra que esta
 * misma tarjeta imprime cuatro líneas más arriba con `formatoPlata`— como 1,5,
 * y aceptaba de contrabando `0x10` y `1e5`.
 *
 * Y es el peor lugar donde podía quedar: es la única puerta del sistema por la
 * que un humano pisa `transactions.amount`. El motor sólo valida la forma
 * (`review/resolve.ts`, `isWritableAmount`), así que 1,5 pasa, la fila entra a
 * todos los totales y queda marcada `source = 'human'` con el monto del parser
 * ya en la auditoría. La invariante 1 del CLAUDE.md dice que el monto sale del
 * parser; la excepción no puede leer mal lo que la persona escribió.
 */
const montoCorregido = computed<number | null>(() => {
  const valor = parsePlata(correccion.value);
  return valor !== null && valor >= 0 ? valor : null;
});

function guardarCorreccion(): void {
  if (montoCorregido.value === null) return;
  emit("corregir", montoCorregido.value);
}
</script>

<template>
  <div class="rc" data-testid="review-card">
    <div class="rc-h">
      <b data-testid="review-contraparte">{{ fila.counterparty ?? "sin contraparte" }}</b>
      <span class="rc-h-der">
        <span class="tag warn">{{ ROTULO_SIN_CONFIRMAR }}</span>
        <span class="small tabular">{{ formatoEntero(posicion) }} de {{ formatoEntero(total) }}</span>
      </span>
    </div>

    <div class="rc-b">
      <div class="cmp">
        <div class="pane">
          <h3 class="label">Monto del ledger</h3>
          <span class="num" data-testid="review-monto">{{ formatoPlata(fila.amount) }}</span>
          <span class="small tabular">{{ fila.currency }} · {{ formatoFecha(fila.ts) ?? fila.ts }}</span>
        </div>
        <div class="pane">
          <h3 class="label">Mientras siga acá</h3>
          <span class="num sm">Fuera de los totales</span>
          <span class="small">no suma en el saldo ni en el gasto por categoría</span>
        </div>
      </div>

      <h3 class="label">Asunto del correo</h3>
      <div class="mail" data-testid="review-asunto">{{ fila.raw_subject ?? "sin asunto" }}</div>

      <!-- R14: el motivo va al lado del botón apagado, no en lugar de él. -->
      <p v-if="otraMoneda" class="aviso" data-testid="review-otra-moneda">
        Este movimiento está en <b>{{ fila.currency }}</b> y tu perfil es <b>{{ monedaPerfil }}</b
        >. El motor suma los montos sin convertir, así que <b>Confirmar</b> queda deshabilitado: metería
        {{ formatoPlata(fila.amount) }} a los totales como si fueran {{ monedaPerfil }}. Las salidas son
        <b>Corregir</b> con el equivalente convertido, o <b>Descartar</b>.
      </p>

      <div class="acts">
        <button
          class="btn pri"
          type="button"
          :disabled="otraMoneda || ocupada"
          :title="otraMoneda ? 'Deshabilitado: el movimiento está en otra moneda' : undefined"
          data-testid="review-confirmar"
          @click="emit('confirmar')"
        >
          Confirmar monto
        </button>
        <label class="sr" :for="`monto-${fila.id}`">Corregir el monto de {{ fila.counterparty }}</label>
        <input
          :id="`monto-${fila.id}`"
          v-model="correccion"
          class="inp tabular"
          inputmode="decimal"
          placeholder="Corregir monto"
          :disabled="ocupada"
          data-testid="review-monto-nuevo"
        />
        <button
          class="btn"
          type="button"
          :disabled="montoCorregido === null || ocupada"
          data-testid="review-corregir"
          @click="guardarCorreccion"
        >
          Guardar corrección
        </button>
        <button
          class="btn badb"
          type="button"
          :disabled="ocupada"
          data-testid="review-descartar"
          @click="emit('descartar')"
        >
          Descartar
        </button>
      </div>

      <!-- R12: qué hace cada acción con el total, a la vista y antes de tocar. -->
      <ul class="quehace" data-testid="review-que-hace">
        <li><b>Confirmar:</b> {{ QUE_HACE_CADA_ACCION.confirm }}</li>
        <li><b>Corregir:</b> {{ QUE_HACE_CADA_ACCION.correct }}</li>
        <li><b>Descartar:</b> {{ QUE_HACE_CADA_ACCION.discard }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
/* `c2-tarjeta-revision.html` literal: borde de atención, cabecera teñida. */
.rc {
  border: 1px solid var(--atencion);
  border-radius: var(--radio-tarjeta);
  background: var(--panel);
  overflow: hidden;
  margin-bottom: 12px;
}
.rc-h {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  background: var(--tag-warn-bg);
  padding: 9px 15px;
  border-bottom: 1px solid var(--atencion);
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
.rc-b {
  padding: 14px 15px;
}
/* Dos columnas donde el sistema dibujaba tres: la de Claude no tiene dato
 * detrás (ver el encabezado). */
.cmp {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 11px;
  margin-bottom: 13px;
}
.pane {
  border: 1px solid var(--linea);
  border-radius: 9px;
  padding: 11px 12px;
  background: var(--fondo);
}
.pane .small {
  display: block;
}
.mail {
  font-size: var(--small-size);
  color: var(--texto-nota);
  line-height: 1.55;
  font-family: var(--fuente-mono);
  background: var(--fondo);
  border: 1px solid var(--linea);
  border-radius: var(--radio-boton);
  padding: 10px 12px;
  overflow-wrap: anywhere;
}
.aviso {
  border-left: 3px solid var(--atencion);
  background: var(--nota-bg);
  padding: 10px 12px;
  border-radius: 0 var(--radio-boton) var(--radio-boton) 0;
  font-size: var(--small-size);
  color: var(--texto-nota);
  margin: 13px 0 0;
}
.acts {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding-top: 13px;
  border-top: 1px solid var(--superficie-suave);
  margin-top: 13px;
}
.inp {
  border: 1px solid var(--linea);
  background: var(--panel);
  color: var(--tinta);
  border-radius: var(--radio-control);
  padding: 7px 11px;
  font: inherit;
  font-size: 13px;
  width: 150px;
}
.inp:disabled {
  background: var(--boton-off-bg);
  color: var(--boton-off-texto);
}
.quehace {
  margin: 12px 0 0;
  padding-left: 18px;
  font-size: var(--small-size);
  color: var(--apagado);
}
.quehace li {
  margin-bottom: 3px;
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
  .cmp {
    grid-template-columns: 1fr;
  }
  .acts {
    flex-direction: column;
    align-items: stretch;
  }
  .inp {
    width: auto;
  }
}
</style>
