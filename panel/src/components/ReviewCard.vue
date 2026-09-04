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
      <!-- El `.why` de `c2-tarjeta-revision.html`: por qué esta fila está acá,
           antes de cualquier cifra. Faltaba, y es lo primero que la tarjeta
           tiene que contestar. -->
      <p class="why" data-testid="review-por-que">
        Cayó en la cola porque las dos lecturas del correo no coincidieron. Mientras siga acá no entra
        en el gasto por categoría, ni en el saldo, ni en el safe-to-spend.
      </p>

      <div class="cmp">
        <!-- `.pane.truth`: la columna de la fuente de verdad, con el verde del
             sistema. Es donde la invariante del motor se vuelve visible — el
             monto sale del parser determinista, nunca de Claude. -->
        <div class="pane truth">
          <h3 class="label">
            Monto del ledger <span class="tag ok">fuente de verdad</span>
          </h3>
          <span class="val" data-testid="review-monto">{{ formatoPlata(fila.amount) }}</span>
          <span class="small tabular">{{ fila.currency }} · {{ formatoFecha(fila.ts) ?? fila.ts }}</span>
        </div>
        <div class="pane">
          <h3 class="label">Mientras siga acá</h3>
          <span class="val n">Fuera de los totales</span>
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
/* El ancho máximo es del sistema: una tarjeta de revisión más larga que 820px
 * deja de leerse como una comparación y pasa a ser una fila. */
.rc {
  border: 1px solid var(--atencion);
  border-radius: var(--radio-tarjeta);
  background: var(--panel);
  overflow: hidden;
  margin-bottom: 12px;
  max-width: 820px;
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
/*
 * Dos columnas donde el sistema dibujaba tres, y la razón es de datos, no de
 * diseño: `c2` pone al lado la lectura del parser y la de Claude, pero
 * `transactions` no guarda la segunda —tiene `amount`, `needs_review` y
 * `source`, y ninguna columna con lo que leyó Claude (`db/schema.ts`)—. La
 * tercera de `c2` ("En el ledger") tampoco: sería la misma cifra que la
 * primera. Inventar una columna con un número plausible sería exactamente lo
 * que la tarjeta existe para impedir.
 *
 * Lo que sí se conserva es lo que la pieza tiene que decir: cuál de las dos
 * lecturas manda. Por eso la columna que queda lleva `.truth`.
 */
.cmp {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 11px;
  margin-bottom: 13px;
}
/* El `.why` de `c2`: por qué esta fila está en la cola, en el ámbar del
 * sistema y antes de cualquier cifra. */
.why {
  font-size: 13px;
  color: var(--aviso-texto);
  background: var(--nota-bg);
  border: 1px solid var(--why-borde);
  border-radius: var(--radio-boton);
  padding: 9px 12px;
  margin: 0 0 13px;
}
.pane {
  border: 1px solid var(--linea);
  border-radius: var(--radio-boton);
  padding: 11px 12px;
  background: var(--superficie-tenue);
  position: relative;
}
/*
 * La cifra de un pane es de 19px, no la de 26px del sistema: acá se comparan
 * dos lecturas al lado de la otra, y a 26px cada columna pide el ojo entera.
 */
.pane .val {
  font-size: 19px;
  font-weight: var(--cifra-weight);
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
  display: block;
  margin: 3px 0 2px;
}
/* Cuando lo que hay que decir no es un número ("Sin leer", "Fuera de los
 * totales"): más chica y apagada, para que nunca se lea como una cantidad. */
.pane .val.n {
  font-size: 15px;
  color: var(--apagado);
  font-weight: 500;
}
/* La columna de la fuente de verdad. El verde no es decoración: es la
 * invariante del motor dicha en el color del sistema para "esto está bien". */
.pane.truth {
  border-color: var(--tag-ok-borde);
  background: var(--pane-truth-bg);
}
/* La columna de la verificación cruzada, en el azul de acción: Claude lee, no
 * decide. */
.pane.claude {
  border-color: var(--tag-acc-borde);
  background: var(--nota-acc-bg);
}
.pane .label {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
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
/* La nota de `c2`: en el tema oscuro no redondea de ningún lado, ni siquiera
 * del libre — se lee como una franja pegada a su barra ámbar. */
.aviso {
  border-left: 3px solid var(--atencion);
  background: var(--nota-bg);
  padding: 10px 12px;
  border-radius: 0;
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
  border-radius: var(--radio-boton);
  padding: 7px 11px;
  font: inherit;
  font-size: 13px;
  width: 145px;
}
/* El campo del motivo comparte la fila con los botones y se lleva el resto. */
.inp.note {
  flex: 1;
  min-width: 160px;
  width: auto;
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
