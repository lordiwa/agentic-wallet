<script setup lang="ts">
/**
 * **Preguntas** — la pantalla del Escenario 1, réplica de `p5-revision.html`
 * para la pestaña *Monto* y de la tarjeta `P5-b` creada en §2.4 para la pestaña
 * *Qué es esto*.
 *
 *   "Entro al sitio → hay transferencias mías a desconocidos → se actualiza
 *    movimientos → me pregunta qué son los movimientos → respondo en alguna
 *    parte qué categoría son"
 *
 * Una pantalla, **dos pestañas, dos preguntas distintas**. No son dos vistas
 * del mismo dato: *Monto* pregunta cuánto fue (4 filas con `needs_review = 1`),
 * *Qué es esto* pregunta qué es (151 contrapartes). Mezclarlas haría que
 * responder una pareciera haber respondido la otra.
 *
 * **El orden entre pestañas.** Si una contraparte aparece en las dos, el monto
 * se pregunta primero, y por una razón que no es de gusto: sin monto afirmado
 * la fila está fuera de todos los totales (`strategy/totals.ts` excluye
 * `needs_review = 1`), así que su categoría no movería ningún gráfico. Por eso
 * la pestaña por defecto es *Monto* cuando hay algo que confirmar, y la tarjeta
 * de categoría avisa cuando su contraparte tiene monto pendiente.
 *
 * **El criterio de terminado es M1, no el vacío.** El progreso por plata está
 * siempre visible y la pantalla celebra al 80 % de la plata cubierta. Con 151
 * contrapartes —90 de ellas de una sola fila— "cero filas" es un estado que
 * nadie alcanza en una tarde, y prometerlo como meta es prometer una derrota.
 * El estado vacío sigue existiendo y sigue siendo confiable; simplemente no es
 * la meta.
 *
 * **Lo que esta pantalla NO es.** No es el editor de reglas (`p6-reglas.html`,
 * decisión **M4**): acá no se escribe un patrón a mano. Responder *ES* crear la
 * regla, y el patrón lo deriva el motor de la contraparte real del ledger —
 * que es lo que hace imposible la trampa conocida del proyecto, un patrón más
 * largo que la contraparte que no matchea nunca.
 *
 * Y una regla que vale para las dos pestañas: **al terminar cualquier acción la
 * pantalla dice qué cambió, con el número** (F13/R19), y si no cambió nada dice
 * por qué. Los textos viven en `lib/efecto.ts`.
 */
import { computed, onMounted, ref, watch } from "vue";
import ClassifyCard from "../components/ClassifyCard.vue";
import ReviewCard from "../components/ReviewCard.vue";
import {
  ErrorDelMotor,
  fetchClassifyProgress,
  fetchClassifyQueue,
  fetchOverview,
  fetchReview,
  postClassify,
  postReviewResolve,
  postSilence,
} from "../api/endpoints";
import type {
  Category,
  ClassifyGroupRow,
  ClassifyProgressResponse,
  OverviewResponse,
  TransactionRow,
} from "../api/types";
import { TAMANO_PAGINA, contrapartesConMontoPendiente, normalizar, ordenarCola, paginar, vistaProgreso } from "../lib/cola";
import { efectoDeClasificar, efectoDeRechazo, efectoDeResolver, efectoDeSilenciar, type Efecto } from "../lib/efecto";
import { formatoEntero, formatoPlata, plural } from "../lib/formato";
import { toHash } from "../router/ruta";

/** Las dos pestañas. Los valores son los que viajan en el hash — el Resumen ya
 * enlaza a `?pestana=monto` y `?pestana=que-es` desde N2. */
type Pestana = "monto" | "que-es";

const props = withDefaults(
  defineProps<{
    /** `?pestana=` del hash. Ausente deja decidir al orden entre pestañas. */
    pestanaPedida?: string;
    /** `?ids=` del hash: el lote del último sync (D7-b). */
    ids?: string;
  }>(),
  { pestanaPedida: "", ids: "" }
);

const grupos = ref<ClassifyGroupRow[]>([]);
const filasDeMonto = ref<TransactionRow[]>([]);
const progreso = ref<ClassifyProgressResponse | null>(null);
const overview = ref<OverviewResponse | null>(null);
const cargando = ref(true);
const errorCarga = ref<string | null>(null);

/** El resultado de la última acción: qué cambió, con el número (F13/R19). */
const efecto = ref<Efecto | null>(null);
/** Hay una escritura en vuelo. Bloquea los botones de todas las tarjetas: una
 * doble respuesta escribiría dos reglas sobre lo mismo. */
const escribiendo = ref(false);

/**
 * Las contrapartes salteadas, por patrón. Vive acá y no en el server a
 * propósito: *Saltar* es "después la veo", no una decisión sobre la plata, y
 * una decisión que no se toma no se persiste. Al recargar vuelven a su lugar
 * por plata, que es lo que uno espera.
 */
const salteadas = ref<Set<string>>(new Set());
const pagina = ref(1);

/* ---- El lote del aviso post-sync (D7-b) ---- */

/** Los ids que llegaron por el hash. Una lista vacía es "sin filtro"; una lista
 * con ids es la cola acotada a lo que entró en ese lote. */
const idsDelLote = computed(() =>
  props.ids
    .split(",")
    .map((parte) => Number(parte.trim()))
    .filter((id) => Number.isInteger(id) && id > 0)
);

/**
 * El filtro por lote se puede soltar sin salir de la pantalla, y **el orden por
 * plata sigue siendo el modo por defecto**: entrar por el aviso acota la vista,
 * no cambia cómo se ordena ni obliga a quedarse ahí.
 */
const soltoElLote = ref(false);
const filtrandoPorLote = computed(() => !soltoElLote.value && idsDelLote.value.length > 0);

/* ---- Qué pestaña se muestra ---- */

const pestanaElegida = ref<Pestana | null>(
  props.pestanaPedida === "monto" || props.pestanaPedida === "que-es" ? props.pestanaPedida : null
);

/**
 * Sin pestaña pedida, la que va primero es *Monto* si hay algo que confirmar.
 * Es el orden entre pestañas: sin monto afirmado la fila no entra a ningún
 * total y su categoría no movería ningún gráfico.
 */
const pestana = computed<Pestana>(() => {
  if (pestanaElegida.value !== null) return pestanaElegida.value;
  return filasDeMonto.value.length > 0 ? "monto" : "que-es";
});

function irA(destino: Pestana): void {
  pestanaElegida.value = destino;
  efecto.value = null;
}

/* ---- Carga ---- */

/**
 * El ledger se leyó de verdad en esta corrida. Es la condición de los dos
 * estados vacíos, y no un detalle: sin ella, un backend caído —server apagado,
 * llave vencida, CORS— dejaba las listas vacías y la pantalla dibujaba
 * *"No queda nada por clasificar"* al lado del cartel de error, afirmando un
 * hecho sobre un ledger que nunca leyó (wargaming del MVP, W5). AC6 pide que el
 * estado vacío sea confiable, y confiable quiere decir exactamente esto: que
 * sólo se dibuje cuando hubo una respuesta.
 */
const ledgerLeido = computed(() => !cargando.value && errorCarga.value === null);

async function cargar(): Promise<void> {
  try {
    const [cola, avance, filas, datos] = await Promise.all([
      fetchClassifyQueue(filtrandoPorLote.value ? { transactionIds: idsDelLote.value } : {}),
      fetchClassifyProgress(),
      fetchReview(),
      fetchOverview(),
    ]);
    grupos.value = cola.groups;
    progreso.value = avance;
    filasDeMonto.value = filas.transactions;
    overview.value = datos;
    errorCarga.value = null;
  } catch (err) {
    errorCarga.value = err instanceof Error ? err.message : String(err);
  } finally {
    cargando.value = false;
  }
}

onMounted(() => {
  void cargar();
});

// Soltar el filtro del lote vuelve a pedir la cola entera.
watch(filtrandoPorLote, () => {
  pagina.value = 1;
  void cargar();
});

/* ---- La cola de "Qué es esto" ---- */

/** El orden de la cola: por plata descendente (como lo manda el motor), con las
 * salteadas al final. */
const cola = computed(() => ordenarCola(grupos.value, salteadas.value));

const paginaActual = computed(() => paginar(cola.value, pagina.value, TAMANO_PAGINA));

/** Los movimientos que esperan monto, por contraparte normalizada: es el aviso
 * "esto va primero" de cada tarjeta. */
const montosPorContraparte = computed(() => contrapartesConMontoPendiente(filasDeMonto.value));

function montosPendientesDe(grupo: ClassifyGroupRow): number {
  return montosPorContraparte.value.get(normalizar(grupo.counterparty)) ?? 0;
}

const avance = computed(() =>
  progreso.value === null ? null : vistaProgreso(progreso.value, { vencido: errorCarga.value !== null })
);

/* ---- Las acciones ---- */

/** Una escritura, con su efecto y su rechazo. Las cuatro acciones de la
 * pantalla pasan por acá para que ninguna se olvide de decir qué cambió. */
async function escribir(accion: () => Promise<Efecto>): Promise<void> {
  if (escribiendo.value) return;
  escribiendo.value = true;
  efecto.value = null;
  try {
    efecto.value = await accion();
  } catch (err) {
    efecto.value = err instanceof ErrorDelMotor ? efectoDeRechazo(err.codigo) : efectoDeRechazo(String(err));
  } finally {
    escribiendo.value = false;
    // Siempre se refresca, también después de un rechazo: la cola es lo que
    // dice cómo quedó, no el mensaje.
    await cargar();
  }
}

function clasificar(grupo: ClassifyGroupRow, category: Category): void {
  void escribir(async () => {
    const respuesta = await postClassify(grupo.counterparty, category);
    // Responder saca la contraparte de la cola: si estaba salteada, ese
    // recuerdo ya no significa nada.
    salteadas.value.delete(grupo.pattern);
    return efectoDeClasificar(respuesta);
  });
}

/** *Saltar*: la tarjeta va al final de la cola y **no se pierde**. No escribe
 * nada en el server y no toca el progreso — la plata de esta contraparte sigue
 * contando como pendiente, que es la verdad. */
function saltar(grupo: ClassifyGroupRow): void {
  const proximas = new Set(salteadas.value);
  proximas.add(grupo.pattern);
  salteadas.value = proximas;
  efecto.value = {
    tono: "neu",
    titulo: `${grupo.counterparty} vuelve al final de la cola.`,
    detalle: `No se perdió y no se respondió: sus ${plural(
      grupo.count,
      "movimiento",
      "movimientos"
    )} por ${formatoPlata(grupo.total)} siguen contando como sin clasificar.`,
  };
}

/** *No preguntarme más por esta* (M5): la salida honesta para la contraparte
 * que no tiene una sola verdad. */
function silenciar(grupo: ClassifyGroupRow): void {
  void escribir(async () => {
    const silenciado = await postSilence(grupo.counterparty);
    salteadas.value.delete(grupo.pattern);
    return efectoDeSilenciar(grupo.counterparty, grupo.count, grupo.total, silenciado.changed);
  });
}

/* ---- Las acciones de la pestaña Monto ---- */

function resolver(fila: TransactionRow, accion: "confirm" | "discard"): void {
  void escribir(async () => efectoDeResolver(await postReviewResolve(fila.id, { action: accion })));
}

function corregir(fila: TransactionRow, amount: number): void {
  void escribir(async () => efectoDeResolver(await postReviewResolve(fila.id, { action: "correct", amount })));
}

/* ---- R14: la moneda del perfil ---- */

/**
 * La moneda contra la que el motor compara (`resolve.ts`). El panel la toma de
 * `overview.balance.currency`, que es la misma que el Resumen ya dibuja al lado
 * del saldo. Sin saldo leído queda en `null`, y entonces no se deshabilita
 * nada: la última palabra la tiene el motor, que rechaza el `confirm` con
 * `foreign_currency` y la pantalla muestra ese motivo.
 */
const monedaPerfil = computed(() => overview.value?.balance?.currency ?? null);

const sinConfirmar = computed(() => filasDeMonto.value.length);
</script>

<template>
  <div>
    <div class="top">
      <div>
        <h1 class="h1">Preguntas</h1>
        <p class="sub">
          Dos preguntas distintas sobre los mismos movimientos: <b>cuánto fue</b> y <b>qué es</b>. Cada respuesta que
          des acá vale para todo el historial de esa contraparte.
        </p>
      </div>
    </div>

    <!-- Las dos pestañas. Monto va primero, y no es un orden decorativo. -->
    <div class="tabs" role="tablist" data-testid="pestanas">
      <button
        class="tab"
        :class="{ on: pestana === 'monto' }"
        role="tab"
        type="button"
        :aria-selected="pestana === 'monto'"
        data-testid="pestana-monto"
        @click="irA('monto')"
      >
        Monto
        <span v-if="sinConfirmar > 0" class="tag warn tabular">{{ formatoEntero(sinConfirmar) }}</span>
      </button>
      <button
        class="tab"
        :class="{ on: pestana === 'que-es' }"
        role="tab"
        type="button"
        :aria-selected="pestana === 'que-es'"
        data-testid="pestana-que-es"
        @click="irA('que-es')"
      >
        Qué es esto
        <span v-if="progreso" class="tag neu tabular">{{ formatoEntero(progreso.groups) }}</span>
      </button>
    </div>

    <div v-if="errorCarga" class="card error" data-testid="preguntas-error">
      <b>El backend no respondió.</b>
      <p class="small">{{ errorCarga }}</p>
    </div>

    <!-- Qué cambió, con el número (F13/R19). Vale para las dos pestañas. -->
    <div v-if="efecto" class="card efecto" :class="efecto.tono" data-testid="efecto">
      <span class="tag" :class="efecto.tono">{{ efecto.tono === "bad" ? "rechazado" : efecto.tono === "neu" ? "sin cambios" : "listo" }}</span>
      <div>
        <b>{{ efecto.titulo }}</b>
        <p class="small">{{ efecto.detalle }}</p>
      </div>
    </div>

    <!-- ================= Pestaña MONTO ================= -->
    <section v-if="pestana === 'monto'" data-testid="panel-monto">
      <p class="sub intro">
        Estos movimientos tienen monto, pero nadie lo confirmó todavía, así que
        <b>están fuera de todos los totales</b>: no suman en el saldo ni en el gasto por categoría. Por eso esta
        pregunta va antes que la otra — sin monto afirmado, decir qué es un movimiento no mueve ningún gráfico.
      </p>

      <div v-if="cargando" class="card"><span class="small">cargando…</span></div>

      <template v-else-if="sinConfirmar > 0">
        <ReviewCard
          v-for="(fila, indice) in filasDeMonto"
          :key="fila.id"
          :fila="fila"
          :posicion="indice + 1"
          :total="sinConfirmar"
          :moneda-perfil="monedaPerfil"
          :ocupada="escribiendo"
          @confirmar="resolver(fila, 'confirm')"
          @corregir="corregir(fila, $event)"
          @descartar="resolver(fila, 'discard')"
        />
      </template>

      <!-- El estado vacío sigue existiendo y sigue siendo confiable. -->
      <div v-else-if="ledgerLeido" class="card vacio" data-testid="monto-vacio">
        <div class="tilde">✓</div>
        <b>Nada esperando confirmación</b>
        <p class="small">
          Todos los movimientos del ledger tienen su monto afirmado y entran a los totales. Es el estado normal, y por
          eso se dice en voz alta.
        </p>
        <a class="btn qui" :href="toHash('resumen')">Volver al Resumen</a>
      </div>
    </section>

    <!-- ================= Pestaña QUÉ ES ESTO ================= -->
    <section v-else data-testid="panel-que-es">
      <!-- El progreso por plata, SIEMPRE visible (M1). -->
      <div v-if="avance" class="card avance" :class="{ celebra: avance.celebra }" data-testid="avance">
        <div class="avance-txt">
          <b>{{ avance.titulo }}</b>
          <p class="small">{{ avance.detalle }}</p>
        </div>
        <span class="track"><i class="fill" :class="avance.celebra ? 'ok' : 'warn'" :style="{ width: `${avance.ancho}%` }"></i></span>
        <p v-if="progreso" class="small pie">
          {{ formatoPlata(progreso.covered_total) }} de {{ formatoPlata(progreso.baseline_total) }} ya respondidos ·
          quedan {{ formatoPlata(progreso.unclassified_total) }} en
          {{ plural(progreso.groups, "contraparte", "contrapartes") }}.
        </p>
      </div>

      <!-- D7-b: se entra acotado al lote, y se puede soltar sin salir. -->
      <div v-if="filtrandoPorLote" class="alert lote" data-testid="filtro-lote">
        <div>
          <b>Sólo lo que entró en el último sync</b>
          <p>
            {{ plural(idsDelLote.length, "movimiento nuevo", "movimientos nuevos") }} llegaron con este lote. Dentro del
            lote el orden sigue siendo por plata, igual que en la cola entera.
          </p>
        </div>
        <button class="btn" type="button" data-testid="soltar-lote" @click="soltoElLote = true">
          Ver la cola entera
        </button>
      </div>

      <div v-if="cargando" class="card"><span class="small">cargando…</span></div>

      <template v-else-if="paginaActual.total > 0">
        <ClassifyCard
          v-for="(grupo, indice) in paginaActual.items"
          :key="grupo.pattern"
          :grupo="grupo"
          :posicion="paginaActual.desde + indice"
          :total="paginaActual.total"
          :montos-pendientes="montosPendientesDe(grupo)"
          :salteada="salteadas.has(grupo.pattern)"
          :ocupada="escribiendo"
          @clasificar="clasificar(grupo, $event)"
          @saltar="saltar(grupo)"
          @silenciar="silenciar(grupo)"
        />

        <!-- W5/R15: la cola se pagina desde el día 1. -->
        <div v-if="paginaActual.paginas > 1" class="paginador" data-testid="paginador">
          <button
            class="btn"
            type="button"
            :disabled="paginaActual.numero <= 1"
            data-testid="pagina-anterior"
            @click="pagina = paginaActual.numero - 1"
          >
            Anteriores
          </button>
          <span class="small tabular" data-testid="pagina-rango">
            {{ formatoEntero(paginaActual.desde) }}–{{ formatoEntero(paginaActual.hasta) }} de
            {{ formatoEntero(paginaActual.total) }} contrapartes · página {{ formatoEntero(paginaActual.numero) }} de
            {{ formatoEntero(paginaActual.paginas) }}
          </span>
          <button
            class="btn"
            type="button"
            :disabled="paginaActual.numero >= paginaActual.paginas"
            data-testid="pagina-siguiente"
            @click="pagina = paginaActual.numero + 1"
          >
            Siguientes
          </button>
        </div>
      </template>

      <div v-else-if="ledgerLeido" class="card vacio" data-testid="que-es-vacio">
        <div class="tilde">✓</div>
        <b>No queda nada por clasificar</b>
        <p class="small">
          {{
            filtrandoPorLote
              ? "Dentro de este lote no quedó ninguna contraparte sin responder."
              : "Todas las contrapartes del ledger tienen su categoría o están silenciadas."
          }}
        </p>
        <a class="btn qui" :href="toHash('resumen')">Volver al Resumen</a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.top {
  margin-bottom: 14px;
}
.intro {
  margin-bottom: 12px;
  max-width: 62em;
}
.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--linea);
  margin-bottom: 14px;
}
.tab {
  border: 0;
  background: none;
  font: inherit;
  font-size: 13.5px;
  color: var(--apagado);
  padding: 8px 14px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.tab.on {
  color: var(--tinta);
  font-weight: 600;
  border-bottom-color: var(--accion);
}
.error {
  border-color: var(--tag-bad-borde);
  margin-bottom: 12px;
}
.efecto {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  margin-bottom: 12px;
}
.efecto.ok {
  border-color: var(--tag-ok-borde);
}
.efecto.neu {
  border-color: var(--linea);
}
.efecto.bad {
  border-color: var(--tag-bad-borde);
}
.efecto p {
  margin: 2px 0 0;
}
.avance {
  margin-bottom: 12px;
}
.avance.celebra {
  border-color: var(--tag-ok-borde);
  background: var(--tag-ok-bg);
}
.avance-txt p {
  margin: 2px 0 9px;
}
.avance .track {
  height: 8px;
}
.avance .pie {
  margin: 8px 0 0;
  display: block;
}
.lote {
  margin-bottom: 12px;
}
.paginador {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 2px 0;
}
.vacio {
  text-align: center;
  padding: 26px;
  border-style: dashed;
}
.vacio b {
  font-size: 14px;
  color: var(--al-dia);
}
.vacio p {
  margin: 3px 0 10px;
}
.tilde {
  font-size: 22px;
  margin-bottom: 4px;
  color: var(--al-dia);
}

@media (max-width: 560px) {
  .tabs {
    overflow-x: auto;
  }
  .paginador {
    flex-direction: column;
    align-items: stretch;
  }
  .lote {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
}
</style>
