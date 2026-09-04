<script setup lang="ts">
/**
 * `OverviewCard` — réplica de `c3-tarjeta-overview.html` del design system:
 * etiqueta 11px en mayúsculas, cifra 26px tabular, nota 12.5px, y la etiqueta
 * de estado en la esquina.
 *
 * **La tarjeta no calcula nada.** Recibe una cifra que el motor ya calculó y la
 * dibuja. Lo único que decide es CÓMO, y esa decisión es una sola y es la que
 * el sistema pone por escrito en su propia nota:
 *
 *   Cero y "sin leer" se dibujan distinto, siempre. `0,00` es una cifra con el
 *   peso tipográfico de un número; un campo que no existe es texto apagado.
 *   Confundirlos convierte un dato faltante en un dato falso.
 *
 * Por eso `valor` no acepta `null` para significar "no sé": quien no tiene el
 * dato pasa `sinDato` con su rótulo. Un `0` que llega acá es un cero de verdad.
 *
 * `destino` es opcional a propósito (R4): las tarjetas cuya pantalla el MVP no
 * construye —Tarjeta, Colchón— muestran su cifra y **no navegan**. Una tarjeta
 * que parece un enlace y no lleva a ningún lado es peor que una que no lo
 * parece.
 */
import { computed } from "vue";
import { formatoPlata } from "../lib/formato";

const props = withDefaults(
  defineProps<{
    /** La etiqueta en mayúsculas: SALDO, SAFE TO SPEND, TARJETA. */
    etiqueta: string;
    /** La cifra ya calculada por el motor. `undefined` cuando no hay dato. */
    valor?: number;
    /**
     * Un valor que no es plata: una fecha, por ejemplo. Se dibuja con el peso
     * de un dato —no apagado— pero sin el cuerpo de 26px de una cifra, que en
     * el sistema está reservado a la plata.
     */
    texto?: string;
    /** El texto que reemplaza a la cifra cuando no hay dato ("Sin leer"). */
    sinDato?: string;
    /** La línea de contexto de abajo. */
    nota?: string;
    /** La etiqueta de estado de la esquina. */
    tag?: { clase: "ok" | "warn" | "bad" | "neu" | "acc"; texto: string } | null;
    /** El hash al que lleva la tarjeta. Sin destino, no es un enlace. */
    destino?: string | null;
    /** Mientras el motor todavía no contestó. */
    cargando?: boolean;
  }>(),
  { valor: undefined, texto: undefined, sinDato: undefined, nota: undefined, tag: null, destino: null, cargando: false }
);

/** Hay cifra sólo si hay un número. `0` es un número. */
const hayCifra = computed(() => typeof props.valor === "number" && Number.isFinite(props.valor));
const cifra = computed(() => (hayCifra.value ? formatoPlata(props.valor as number) : ""));
const navega = computed(() => props.destino !== null && props.destino !== undefined);
</script>

<template>
  <component
    :is="navega ? 'a' : 'div'"
    class="card"
    :class="{ lnk: navega }"
    :href="navega ? destino : undefined"
    data-testid="overview-card"
  >
    <span v-if="tag" class="corner"><span class="tag" :class="tag.clase">{{ tag.texto }}</span></span>
    <h3 class="label">{{ etiqueta }}</h3>

    <template v-if="cargando">
      <span class="sk a"></span>
      <span class="sk b"></span>
      <span class="small cargando">cargando…</span>
    </template>
    <span v-else-if="hayCifra" class="num" data-testid="overview-card-cifra">{{ cifra }}</span>
    <span v-else-if="texto" class="num texto tabular" data-testid="overview-card-texto">{{ texto }}</span>
    <span v-else class="num sm" data-testid="overview-card-sin-dato">{{ sinDato }}</span>

    <span v-if="nota" class="small">{{ nota }}</span>
    <slot />
  </component>
</template>

<style scoped>
.card {
  min-width: 0;
}
.corner {
  position: absolute;
  top: 12px;
  right: 14px;
}
/* El esqueleto de carga de `c3`: dos bloques del gris de superficie, con el
 * radio de control — es la esquina más cerrada del sistema, y un placeholder no
 * puede parecer más blando que el dato que va a reemplazarlo. */
.sk {
  background: var(--superficie-suave);
  border-radius: var(--radio-control);
  display: block;
}
.sk.a {
  height: 22px;
  width: 64%;
  margin: 4px 0 6px;
}
.sk.b {
  height: 11px;
  width: 82%;
}
.cargando {
  display: block;
  margin-top: 7px;
}
/* Un dato que no es plata: mismo peso, cuerpo más chico. Los 26px del sistema
 * son de la cifra de plata. */
.num.texto {
  font-size: 20px;
}
.small {
  display: block;
}
</style>
