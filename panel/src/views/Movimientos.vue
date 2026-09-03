<script setup lang="ts">
/**
 * **Movimientos** — la tercera puerta del Escenario 1 y el ledger navegable,
 * réplica de `p4-movimientos.html` con la tabla de `c4-tabla-transacciones.html`.
 *
 * Es la fase más barata del MVP porque no estrena motor: la ruta
 * (`GET /api/transactions`) ya funcionaba, la categoría recalculada la resolvió
 * N1 (`classify/movements.ts`) y el escritor de *¿Qué es esto?* es el mismo de
 * la cola (`POST /api/classify`). Lo que faltaba era dibujarlo.
 *
 * Las tres decisiones que se toman acá:
 *
 * 1. **Dos filtros, no una barra.** De los seis controles de la `FilterBar` del
 *    sistema, cuatro no tienen respaldo: categoría como `WHERE category = ?`
 *    estaba mal planteado (H21), tipo multi-selección e *Interna* como dirección
 *    (H22) y el autocompletar de contrapartes (H23). Con dos no hace falta una
 *    barra: son dos controles arriba de la tabla, con el estilo de
 *    `c6-selector-filtros.html`. **`FilterBar.vue` no se construye.**
 * 2. **La categoría no es un filtro más: es de dónde se viene.** Se llega desde
 *    una barra del gráfico del Resumen (`#/movimientos?categoria=salud`), y
 *    entonces la lista es **la selección de la barra**, recalculada por el motor
 *    — no la columna `category`, que puede estar vieja o sin backfill. Mientras
 *    esté puesta, los dos filtros no van: cambiarlos daría otro conjunto y el
 *    conteo dejaría de coincidir con el número que la barra dibujó, que es
 *    exactamente lo que H21 existe para evitar. Se suelta con un click.
 * 3. **Una sola acción nueva en el detalle.** *Crear regla* llevaba a
 *    `p6-reglas.html` (eliminada, **M4**), *Preguntar al agente* al chat
 *    (diferido, **M2**) y *Resolver* a la pestaña de monto de N3. Queda
 *    *¿Qué es esto?*, que escribe con el mismo escritor que la cola — y por eso
 *    responder acá baja también la fila de la cola de Preguntas.
 *
 * Lo que **no** se construye, y es una decisión escrita y no un olvido:
 * *Mandar a revisión* (**H26**) y *Recuperar contraparte* (**H25**, que es
 * trabajo por lote y no por fila).
 *
 * Y la regla que vale para toda escritura del panel: **al terminar, se dice qué
 * cambió con el número, y si no cambió nada, por qué** (F13/R19). Los textos
 * viven en `lib/efecto.ts`, compartidos con la cola.
 */
import { computed, onMounted, ref, watch } from "vue";
import TransactionsTable from "../components/TransactionsTable.vue";
import { ErrorDelMotor, fetchTransactions, postClassify } from "../api/endpoints";
import type { Category, TransactionRow } from "../api/types";
import { useRefresh } from "../composables/useRefresh";
import { nombreCategoria } from "../lib/categorias";
import { efectoDeClasificar, efectoDeRechazo, type Efecto } from "../lib/efecto";
import { formatoEntero, formatoPlata, plural } from "../lib/formato";
import { timeAgo } from "../lib/freshness";
import {
  LIMITE_MAXIMO,
  SIN_FILTROS,
  TAMANO_MOVIMIENTOS,
  categoriaPedida,
  consultaDe,
  filtrosAplicados,
  hayFiltros,
  hayMas,
  type FiltrosMovimientos,
} from "../lib/movimientos";
import { toHash } from "../router/ruta";

const props = withDefaults(defineProps<{ categoria?: string }>(), { categoria: "" });

const filas = ref<TransactionRow[]>([]);
/** El conteo de la barra: sólo existe cuando se pidió una categoría. `null` es
 * "el motor no lo manda", que con *cargar más* no hace falta (H20). */
const totalDeLaBarra = ref<number | null>(null);
const plataDeLaBarra = ref<number | null>(null);

const cargando = ref(true);
const cargandoMas = ref(false);
const errorCarga = ref<string | null>(null);
/** La hora de la última lectura que salió bien — lo único que el rótulo de
 * frescura puede decir con verdad (W31). */
const ultimaLecturaOk = ref<Date | null>(null);

const filtros = ref<FiltrosMovimientos>({ ...SIN_FILTROS });

/** La fila abierta y el resultado de la última respuesta. */
const abierta = ref<number | null>(null);
const efecto = ref<Efecto | null>(null);
const escribiendo = ref(false);
/** La fila respondida ya no cae en esta lista. Pasa en modo categoría: se le
 * cambió la categoría, así que salió de la barra. Es correcto, y se dice. */
const salioDeLaLista = ref(false);

const reloj = useRefresh();

/* ---- De dónde se viene (criterio 3) ---- */

/** La categoría del hash, validada contra el glosario del motor. Se puede
 * soltar sin salir de la pantalla. */
const soltoLaCategoria = ref(false);
const categoria = computed<Category | null>(() =>
  soltoLaCategoria.value ? null : categoriaPedida(props.categoria)
);
const enModoCategoria = computed(() => categoria.value !== null);
const nombreDeLaCategoria = computed(() => (categoria.value === null ? "" : nombreCategoria(categoria.value)));

/* ---- Carga ---- */

/**
 * Trae desde `offset`. Con `acumular` las filas se agregan al final (*cargar
 * más*); sin él reemplazan lo que había (un filtro nuevo es una consulta nueva,
 * nunca un recorte en el cliente — la regla del sistema en
 * `c6-selector-filtros.html`).
 */
async function traer(offset: number, acumular: boolean, limite = TAMANO_MOVIMIENTOS): Promise<void> {
  try {
    const respuesta = await fetchTransactions(
      consultaDe(filtros.value, { categoria: categoria.value, limite, offset })
    );
    filas.value = acumular ? [...filas.value, ...respuesta.transactions] : respuesta.transactions;
    totalDeLaBarra.value = respuesta.total ?? null;
    plataDeLaBarra.value = respuesta.amount ?? null;
    errorCarga.value = null;
    ultimaLecturaOk.value = new Date();
  } catch (err) {
    // No se dejan filas viejas con cara de actuales (`c4`, estado *Sin
    // conexión*): si el backend no responde, la tabla se vacía y se dice.
    if (!acumular) filas.value = [];
    errorCarga.value = err instanceof Error ? err.message : String(err);
  }
}

async function cargar(): Promise<void> {
  cargando.value = true;
  await traer(0, false);
  cargando.value = false;
}

async function cargarMas(): Promise<void> {
  if (cargandoMas.value) return;
  cargandoMas.value = true;
  await traer(filas.value.length, true);
  cargandoMas.value = false;
}

/**
 * Refresca lo que ya está a la vista **sin perder las páginas cargadas**: si
 * alguien trajo 150 filas y respondió una pregunta, volver a 50 le haría creer
 * que perdió lo demás. El pedido se acota al tope del schema del server.
 */
async function recargar(): Promise<void> {
  const cuantas = Math.min(Math.max(filas.value.length, TAMANO_MOVIMIENTOS), LIMITE_MAXIMO);
  await traer(0, false, cuantas);
}

onMounted(() => {
  void cargar();
});

watch(reloj.tick, () => {
  void recargar();
});

/** Cambiar un filtro —o soltar la categoría— es una consulta nueva, no un
 * recorte de la lista que ya está. */
watch([filtros, categoria], () => {
  abierta.value = null;
  efecto.value = null;
  salioDeLaLista.value = false;
  void cargar();
}, { deep: true });

/* ---- La única escritura de la pantalla ---- */

/**
 * *¿Qué es esto?* sobre una fila. Escribe **una regla** sobre la contraparte,
 * con el mismo endpoint que la cola: no hay una segunda forma de escribir una
 * categoría en el MVP, y por eso responder acá también saca esa contraparte de
 * la cola de Preguntas.
 */
async function clasificar(fila: TransactionRow, category: Category): Promise<void> {
  if (escribiendo.value || fila.counterparty === null) return;
  escribiendo.value = true;
  efecto.value = null;
  salioDeLaLista.value = false;
  const respondida = fila.id;
  try {
    efecto.value = efectoDeClasificar(await postClassify(fila.counterparty, category));
  } catch (err) {
    efecto.value = err instanceof ErrorDelMotor ? efectoDeRechazo(err.codigo) : efectoDeRechazo(String(err));
  } finally {
    escribiendo.value = false;
    // Siempre se refresca, también después de un rechazo: la lista es lo que
    // dice cómo quedó, no el mensaje.
    await recargar();
    if (!filas.value.some((f) => f.id === respondida)) {
      salioDeLaLista.value = true;
      abierta.value = null;
    }
  }
}

/* ---- Lo que la pantalla dice ---- */

// Cuándo se leyó BIEN, no cuándo latió el reloj (wargaming ronda 4, W31): con
// el backend caído el tick sigue corriendo, y la cabecera decía "actualizado
// recién" arriba del cartel rojo y de una tabla vacía.
const actualizado = computed(() => {
  void reloj.tick.value;
  return ultimaLecturaOk.value === null ? null : timeAgo(ultimaLecturaOk.value.toISOString());
});

const aplicados = computed(() => filtrosAplicados(filtros.value));

const puedeCargarMas = computed(() =>
  hayMas(filas.value.length, TAMANO_MOVIMIENTOS, totalDeLaBarra.value ?? undefined)
);

/**
 * El conteo del pie de los filtros.
 *
 * En modo categoría dice **el número de la barra**, que es el punto entero de
 * H21: si el gráfico dijo "salud 180,00 en 12 movimientos", la lista dice los
 * mismos dos números. Sin categoría no hay total y no se inventa uno: se dice
 * cuántas hay a la vista, que es lo que *cargar más* sabe (H20).
 */
const conteo = computed(() => {
  if (enModoCategoria.value && totalDeLaBarra.value !== null) {
    const plata = plataDeLaBarra.value === null ? "" : ` · ${formatoPlata(plataDeLaBarra.value)}`;
    return `${plural(totalDeLaBarra.value, "movimiento", "movimientos")}${plata} en ${
      nombreDeLaCategoria.value
    } este mes — es lo que contó la barra del gráfico.`;
  }
  const cuantos = `${formatoEntero(filas.value.length)} a la vista`;
  return aplicados.value === 0
    ? `${cuantos}. Los más recientes primero.`
    : `${cuantos} · ${plural(aplicados.value, "filtro aplicado", "filtros aplicados")}.`;
});

function limpiar(): void {
  filtros.value = { ...SIN_FILTROS };
}

/** Abrir o cerrar el detalle borra el efecto anterior: el mensaje es de la
 * respuesta que se acaba de dar, no un cartel que queda pegado a la pantalla. */
function abrirFila(id: number | null): void {
  abierta.value = id;
  efecto.value = null;
  salioDeLaLista.value = false;
}
</script>

<template>
  <div>
    <div class="top">
      <div>
        <h1 class="h1">Movimientos</h1>
        <p class="sub">
          El ledger navegable. Se deriva del correo — acá no se edita a mano: una corrección pasa por la cola de
          Preguntas, que deja rastro.
        </p>
      </div>
      <span v-if="actualizado" class="small" data-testid="movimientos-actualizado">actualizado {{ actualizado }}</span>
    </div>

    <!-- Los dos filtros, con el estilo de `c6-selector-filtros.html` y SIN la
         barra: radio de control, borde de línea, tipografía 13px. -->
    <div class="card filtros">
      <div class="controles">
        <!-- Cuando se llega desde una barra, la categoría se dibuja como el
             control activo de `c6` y se puede soltar. -->
        <span v-if="enModoCategoria" class="sel act" data-testid="chip-categoria">
          <b>Categoría</b> {{ nombreDeLaCategoria }}
          <button class="x" type="button" data-testid="soltar-categoria" @click="soltoLaCategoria = true">✕</button>
        </span>

        <label class="sel" :class="{ off: enModoCategoria }">
          <b>Desde</b>
          <input v-model="filtros.desde" type="date" :disabled="enModoCategoria" data-testid="filtro-desde" />
        </label>
        <label class="sel" :class="{ off: enModoCategoria }">
          <b>Hasta</b>
          <input v-model="filtros.hasta" type="date" :disabled="enModoCategoria" data-testid="filtro-hasta" />
        </label>
        <label class="sel" :class="{ off: enModoCategoria }">
          <b>Dirección</b>
          <select v-model="filtros.direccion" :disabled="enModoCategoria" data-testid="filtro-direccion">
            <option value="">Todas</option>
            <option value="in">Entrada</option>
            <option value="out">Salida</option>
          </select>
        </label>

        <button
          v-if="hayFiltros(filtros) && !enModoCategoria"
          class="btn qui"
          type="button"
          data-testid="limpiar-filtros"
          @click="limpiar"
        >
          Limpiar filtros
        </button>
      </div>

      <p class="conteo" data-testid="conteo-filtros">{{ conteo }}</p>

      <!-- Por qué los dos filtros están apagados. Un control deshabilitado sin
           explicación es peor que no estar. -->
      <p v-if="enModoCategoria" class="small nota-cat" data-testid="nota-categoria">
        Esta lista es la de una barra del gráfico: el motor la rehace recalculando la categoría, que es lo único que
        hace que tenga las filas que la barra contó. Filtrarla por fecha o dirección daría otro conjunto y el número
        dejaría de coincidir, así que los dos filtros esperan a que sueltes la categoría.
      </p>
      <p v-else class="small nota-cat">
        Reversos, transferencias internas y descartados no se listan: el motor ya los excluyó de los totales, y el
        interruptor para mostrarlos no entra al MVP.
      </p>
    </div>

    <div v-if="errorCarga" class="card error" data-testid="movimientos-error">
      <b>El backend no respondió.</b>
      <p class="small">{{ errorCarga }}</p>
    </div>

    <!-- La respuesta se dio en el detalle, y ahí se dice qué cambió; pero si la
         fila salió de esta lista, el detalle ya no está para decirlo. -->
    <div v-if="salioDeLaLista && efecto" class="card efecto" :class="efecto.tono" data-testid="efecto-huerfano">
      <span class="tag" :class="efecto.tono">{{ efecto.tono === "bad" ? "rechazado" : "listo" }}</span>
      <div>
        <b>{{ efecto.titulo }}</b>
        <p class="small">
          {{ efecto.detalle }}
          <template v-if="enModoCategoria">
            El movimiento salió de esta lista porque ya no cae en esta categoría — que es, justamente, lo que
            acabás de decidir.
          </template>
        </p>
      </div>
    </div>

    <TransactionsTable
      :filas="filas"
      :categoria="categoria"
      :abierta="abierta"
      :efecto="salioDeLaLista ? null : efecto"
      :ocupada="escribiendo"
      :cargando="cargando"
      :hay-mas="puedeCargarMas"
      :cargando-mas="cargandoMas"
      @abrir="abrirFila"
      @clasificar="clasificar"
      @cargar-mas="cargarMas"
    />

    <p v-if="!cargando && filas.length === 0 && hayFiltros(filtros)" class="vacio-acc">
      <button class="btn" type="button" data-testid="vacio-limpiar" @click="limpiar">Limpiar filtros</button>
    </p>
    <p v-else-if="!cargando && filas.length === 0 && enModoCategoria" class="vacio-acc">
      <a class="btn" :href="toHash('resumen')">Volver al Resumen</a>
    </p>
  </div>
</template>

<style scoped>
.top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}
.filtros {
  margin-bottom: 12px;
}
.controles {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
/*
 * El control de `c6-selector-filtros.html`, con el radio del sistema (6, §2.1):
 * borde de línea, 13px, etiqueta en 11px mayúsculas apagada.
 */
.sel {
  border: 1px solid var(--linea);
  border-radius: var(--radio-control);
  padding: 6px 11px;
  font-size: 13px;
  background: var(--panel);
  display: inline-flex;
  align-items: center;
  gap: 7px;
  white-space: nowrap;
}
.sel b {
  font-weight: 600;
  color: var(--apagado);
  font-size: var(--label-size);
  text-transform: uppercase;
  letter-spacing: var(--label-tracking);
}
.sel input,
.sel select {
  border: 0;
  background: none;
  font: inherit;
  font-size: 13px;
  color: var(--tinta);
  padding: 0;
}
.sel input:disabled,
.sel select:disabled {
  color: var(--boton-off-texto);
}
.sel.off {
  background: var(--boton-off-bg);
}
/* El control activo de `c6`: el mismo azul de acción, en su versión clara. */
.sel.act {
  border-color: var(--accion);
  background: var(--tag-acc-bg);
  color: var(--tag-acc-texto);
}
.sel.act b {
  color: var(--tag-acc-texto);
}
.sel .x {
  border: 0;
  background: none;
  color: var(--tag-acc-texto);
  font: inherit;
  font-size: var(--small-size);
  cursor: pointer;
  padding: 0;
}
.conteo {
  font-size: var(--small-size);
  color: var(--apagado);
  margin: 11px 0 0;
  padding-top: 11px;
  border-top: 1px solid var(--superficie-suave);
}
.nota-cat {
  margin: 6px 0 0;
  display: block;
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
.efecto.bad {
  border-color: var(--tag-bad-borde);
}
.efecto p {
  margin: 2px 0 0;
}
.vacio-acc {
  text-align: center;
  margin: 12px 0 0;
}

@media (max-width: 560px) {
  .top {
    flex-direction: column;
    gap: 8px;
  }
  .controles {
    align-items: stretch;
    flex-direction: column;
  }
  .sel {
    justify-content: space-between;
  }
}
</style>
