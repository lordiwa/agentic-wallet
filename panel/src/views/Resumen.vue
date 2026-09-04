<script setup lang="ts">
/**
 * El Resumen: el hogar del panel, réplica de `p2-resumen.html`.
 *
 * Lo que se toma del sistema, tal cual: la cabecera con estado y acción, la
 * rejilla de tarjetas, el gráfico de barras por categoría y el aviso `.alert`
 * amarillo.
 *
 * Lo que se recorta, y por qué (§2.5 pide que la diferencia esté escrita):
 *
 * - **El brief** (`GET /api/brief`) no se dibuja: el modo demo no lo cubre
 *   (R16), y una tarjeta que en demo queda vacía es peor que no estar.
 * - **Tarjeta y Colchón muestran su cifra y no navegan** (R4): sus pantallas
 *   —`p8-estrategia`, `p9-ahorro`— no entran al MVP. Una tarjeta que parece un
 *   enlace y no lleva a ningún lado miente sobre lo que la app puede hacer.
 * - **Sincronizar ahora** no lleva a una pantalla de sincronización: el ciclo
 *   entero vive en el chip de acá arriba.
 *
 * Lo que se agrega, porque el motor de N1 ya lo puede contestar: los dos avisos
 * post-sync, **separados**. Uno pregunta un monto y lleva a la pestaña *Monto*;
 * el otro pregunta una categoría y lleva a la cola acotada a lo que entró en el
 * último lote (D7-b). Mezclarlos haría que responder uno parezca haber
 * respondido el otro.
 *
 * Y una regla que es del cliente y sólo del cliente (**R7**):
 * `strategy/balance.ts` devuelve `0` cuando no hay día de pago conocido —es un
 * guardia contra dividir por cero, no una afirmación—, así que el panel deriva
 * ese estado de `next_payday`, que sí distingue. Decir "podés gastar 0,00 hoy"
 * cuando el dato es "todavía no sé" es inventar una respuesta.
 */
import { computed, onMounted, ref, watch } from "vue";
import OverviewCard from "../components/OverviewCard.vue";
import SyncButton from "../components/SyncButton.vue";
import {
  fetchClassifyProgress,
  fetchOverview,
  fetchRecurring,
  fetchSyncStatus,
  postSync,
} from "../api/endpoints";
import type {
  ClassifyProgressResponse,
  OverviewResponse,
  RecurringResponse,
  SyncStatusResponse,
  SyncTriggerResponse,
} from "../api/types";
import { DEFAULT_REFRESH_MS, SYNC_REFRESH_MS, useRefresh } from "../composables/useRefresh";
import { barrasDeCategoria } from "../lib/categorias";
import { vistaColchon } from "../lib/colchon";
import { timeAgo } from "../lib/freshness";
import { tarjetaGastosFijos } from "../lib/gastos-fijos";
import { ROTULO_SIN_LEER, formatoEntero, formatoFecha, formatoPlata, plural } from "../lib/formato";
import { tagSync, vistaSync, type Backlog, type FallaSync } from "../lib/sync-estado";
import { toHash } from "../router/ruta";

const overview = ref<OverviewResponse | null>(null);
const estadoSync = ref<SyncStatusResponse | null>(null);
const cola = ref<ClassifyProgressResponse | null>(null);
/** El análisis del historial (N4). `null` es "el server no contestó", y con eso
 * la tarjeta de entrada no se dibuja: lo que no tiene backend no se dibuja. */
const gastosFijos = ref<RecurringResponse | null>(null);
const cargando = ref(true);
const errorCarga = ref<string | null>(null);
/**
 * **Cuándo se leyó bien** (wargaming ronda 4, W31), que es lo único que el
 * rótulo *"actualizado hace X"* puede decir con verdad. El reloj compartido late
 * igual con el backend caído: usar su `lastRefreshAt` hacía que la cabecera
 * dijera *"actualizado recién"* al lado del cartel rojo, sobre las cifras de la
 * última lectura buena.
 */
const ultimaLecturaOk = ref<Date | null>(null);

/** Esta pestaña disparó un lote y todavía no volvió. */
const enVuelo = ref(false);
const falla = ref<FallaSync | null>(null);
/** Los ids del último lote, que es a lo que se acota el aviso de categoría.
 * Opacos: entero del server local o `gmail_msg_id` de las funciones (ver
 * `functions/src/ledger/rows.ts`). */
const ultimoLote = ref<(string | number)[]>([]);

const reloj = useRefresh();

/**
 * El hogar se carga **pieza por pieza**, y esa es la corrección de fondo.
 *
 * Era un `Promise.all` de tres: la primera que rechazara tumbaba las otras dos,
 * y con el pivot a medias el fallo de una ruta sin portar se llevaba puesto al
 * `/api/overview` real —el que trae las cifras de verdad— dejando el Resumen
 * con el cartel de desconexión arriba de cuatro tarjetas vacías, sobre un
 * backend sano.
 *
 * Ya no hay rutas sin portar, pero la separación se queda: **una ruta lenta o
 * caída no puede vaciar las otras tres**. Lo que contesta se dibuja, y sólo un
 * fallo del overview enciende el cartel rojo.
 */
async function cargar(): Promise<void> {
  const [datos, sync, progreso, recurrentes] = await Promise.allSettled([
    fetchOverview(),
    fetchSyncStatus(),
    fetchClassifyProgress(),
    fetchRecurring(),
  ]);

  if (datos.status === "fulfilled") {
    overview.value = datos.value;
    errorCarga.value = null;
    ultimaLecturaOk.value = new Date();
  } else {
    // No se dibuja el último valor conocido con cara de actual (`c3`): si el
    // backend no responde, se dice.
    errorCarga.value = datos.reason instanceof Error ? datos.reason.message : String(datos.reason);
  }

  estadoSync.value = sync.status === "fulfilled" ? sync.value : null;
  cola.value = progreso.status === "fulfilled" ? progreso.value : null;

  // Con su propio destino desde siempre: un server anterior a N4 devuelve 404
  // en esta ruta, y eso nunca pudo tumbar el hogar. Sin respuesta, la tarjeta
  // de entrada simplemente no se dibuja.
  gastosFijos.value = recurrentes.status === "fulfilled" ? recurrentes.value : null;

  cargando.value = false;
}

/** El mensaje que trae `postSync` es el `error` del cuerpo, tal cual; de ahí
 * sale el código, que es lo que cambia el cartel. */
function fallaDe(err: unknown): FallaSync {
  const mensaje = err instanceof Error ? err.message : String(err);
  if (mensaje.includes("sync_already_running") || mensaje.includes("409")) return { codigo: 409, mensaje };
  if (mensaje.includes("gmail_not_configured") || mensaje.includes("503")) return { codigo: 503, mensaje };
  return { codigo: "otro", mensaje };
}

/**
 * Un lote. **Uno**: si vuelve `complete:false` el botón pasa a *Seguir* y ahí
 * queda, esperando que alguien lo pulse. Encadenar solo sería el único bucle de
 * requests sin supervisión del panel, sobre un buzón que puede tener miles de
 * correos.
 */
async function sincronizar(): Promise<void> {
  if (enVuelo.value) return;
  enVuelo.value = true;
  falla.value = null;
  try {
    const respuesta = (await postSync()) as SyncTriggerResponse;
    ultimoLote.value = respuesta.inserted_ids ?? [];
  } catch (err) {
    falla.value = fallaDe(err);
  } finally {
    enVuelo.value = false;
    // Lo que el sync acaba de escribir tiene que verse sin esperar al próximo
    // intervalo.
    reloj.refreshNow();
    await cargar();
  }
}

const backlog = computed<Backlog | null>(() => estadoSync.value?.backlog ?? null);

const entradaSync = computed(() => ({
  lastSyncTs: estadoSync.value?.last_sync_ts ?? null,
  backlog: backlog.value,
  // R9: `running` llega del server. Ausente (un server anterior a N2) no es
  // `false` afirmado: es "no sé", y se dibuja como no-corriendo.
  running: estadoSync.value?.running === true,
  enVuelo: enVuelo.value,
  falla: falla.value,
}));

const vista = computed(() => vistaSync(entradaSync.value));
const tagEstado = computed(() => tagSync(vista.value.estado));

/** Mientras hay un lote en vuelo el panel consulta más seguido, y al terminar
 * vuelve al ritmo normal (`p3-sincronizacion.html`). */
watch(
  () => vista.value.estado === "corriendo" && !vista.value.habilitado,
  (corriendo) => reloj.setIntervalMs(corriendo ? SYNC_REFRESH_MS : DEFAULT_REFRESH_MS)
);

watch(reloj.tick, () => {
  void cargar();
});

onMounted(() => {
  void cargar();
});

// El rótulo cuelga de la última lectura BUENA, no del tick: ver
// `ultimaLecturaOk`. Sigue dependiendo del reloj para volver a calcularse
// —cada tick lo envejece un minuto más— pero no para fecharse.
const actualizado = computed(() => {
  void reloj.tick.value;
  return ultimaLecturaOk.value === null ? null : timeAgo(ultimaLecturaOk.value.toISOString());
});

/* ---- Las cifras. Ninguna se calcula acá: todas llegan del motor. ---- */

const saldo = computed(() => overview.value?.balance?.amount);
const moneda = computed(() => overview.value?.balance?.currency ?? "");

/**
 * R7. `safe_to_spend_hoy` viene `0` tanto cuando de verdad no queda nada como
 * cuando no hay día de pago conocido. `next_payday` es el que distingue: sin
 * él, la respuesta honesta es que todavía no se sabe.
 */
const hayDiaDePago = computed(() => (overview.value?.next_payday ?? null) !== null);
const safeToSpend = computed(() => (hayDiaDePago.value ? overview.value?.safe_to_spend_hoy : undefined));

const colchon = computed(() => overview.value?.buffer_status ?? null);

/**
 * El saldo de la tarjeta sale del **resumen crudo**, no de `card_status`.
 *
 * `tarjetaStatus` rellena con cero lo que no pudo leer
 * (`server/src/strategy/card.ts`: `statement.balance ?? 0`), así que un resumen
 * cuyo saldo no se pudo parsear —persistible: el ingestor sólo rechaza el
 * resumen si los tres campos vienen nulos— llegaba acá como un `0` y se
 * dibujaba con el peso de una cifra: indistinguible de una tarjeta pagada. Es
 * literalmente lo que `ROTULO_SIN_LEER` existe para impedir (R6/X8/X11), y el
 * dato honesto ya viene en la respuesta, que el calendario de más abajo usa
 * bien (wargaming del MVP, W6).
 */
const saldoDeTarjeta = computed(() => overview.value?.card?.balance ?? null);

const notaDeTarjeta = computed(() => {
  const resumen = overview.value?.card;
  if (!resumen) return "no hay resumen de tarjeta leído";
  const minimo = resumen.min_payment === null ? ROTULO_SIN_LEER : formatoPlata(resumen.min_payment);
  return `mínimo ${minimo} · fecha máxima ${formatoFecha(resumen.due_date ?? null) ?? ROTULO_SIN_LEER}`;
});

/**
 * **R25.** El motor manda `financiado: true` cuando el objetivo es cero, porque
 * `0 >= 0` es verdadero — así que un usuario recién llegado veía el anillo
 * lleno, en verde, "financiado", sin haber reservado un peso. Quién decide cómo
 * se dibuja eso está en `lib/colchon.ts`, con sus tests: acá sólo se usa.
 */
const anillo = computed(() => vistaColchon(colchon.value));

/** La tarjeta de entrada al análisis del historial (N4, criterio 9). */
const entradaGastosFijos = computed(() =>
  tarjetaGastosFijos({
    recurring: gastosFijos.value,
    hayDiaDePago: hayDiaDePago.value,
    colchonFijado: anillo.value.fijado,
  })
);

const proximoPago = computed(() => formatoFecha(overview.value?.next_payday ?? null));

const barras = computed(() => barrasDeCategoria(overview.value?.spending_by_category ?? {}));

/** "Sin confirmar": filas con `needs_review = 1`. Tienen monto — lo que falta
 * es confirmarlo, y hasta entonces no entran en ningún total. */
const sinConfirmar = computed(() => overview.value?.counts?.needs_review ?? 0);

/** "Sin clasificar": movimientos cuya categoría el motor no sabe, agrupados por
 * contraparte. Es otra pregunta y otra pantalla. */
const sinClasificar = computed(() => cola.value?.transactions ?? 0);
const comercios = computed(() => cola.value?.groups ?? 0);

const destinoMonto = toHash("preguntas", { pestana: "monto" });
const destinoCategoria = computed(() =>
  ultimoLote.value.length > 0
    ? toHash("preguntas", { pestana: "que-es", ids: ultimoLote.value.join(",") })
    : toHash("preguntas", { pestana: "que-es" })
);
</script>

<template>
  <div class="resumen">
    <div class="top">
      <div>
        <h1 class="h1">Resumen</h1>
        <p class="sub">Qué pasa hoy, en diez segundos.</p>
      </div>
      <div class="topr">
        <span class="fresh">
          <span class="tag" :class="tagEstado.clase" data-testid="resumen-estado">{{ tagEstado.texto }}</span>
          <span v-if="actualizado">actualizado {{ actualizado }}</span>
        </span>
      </div>
    </div>

    <!-- El chip del sync: disparar, la barra, Seguir, hasta Al día. La
         pantalla P3 no existe; esto es todo el ciclo. -->
    <div class="card chip" data-testid="chip-sync">
      <SyncButton :entrada="entradaSync" @sincronizar="sincronizar" />
    </div>

    <div v-if="errorCarga" class="card error" data-testid="resumen-error">
      <b>El backend no respondió.</b>
      <p class="small">{{ errorCarga }}</p>
    </div>

    <!-- Los dos avisos, separados y con dos destinos distintos. -->
    <div v-if="sinConfirmar > 0" class="alert" data-testid="aviso-monto">
      <div>
        <b>{{ plural(sinConfirmar, "movimiento necesita", "movimientos necesitan") }} tu confirmación</b>
        <p>
          El parser y Claude no coincidieron. Están fuera de todos los totales hasta que los resuelvas.
        </p>
      </div>
      <a class="btn" :href="destinoMonto">Ver {{ formatoEntero(sinConfirmar) }} sin confirmar</a>
    </div>

    <div v-if="sinClasificar > 0" class="alert" data-testid="aviso-categoria">
      <div>
        <b>
          {{ formatoEntero(sinClasificar) }} sin clasificar en
          {{ plural(comercios, "comercio", "comercios") }}
        </b>
        <p v-if="ultimoLote.length > 0">
          El último lote trajo movimientos nuevos. Esta pregunta es por lo que acaba de entrar.
        </p>
        <p v-else>Cada respuesta escribe una regla y vale para todos los movimientos de ese comercio.</p>
      </div>
      <a class="btn" :href="destinoCategoria">Decir qué son</a>
    </div>

    <!-- La entrada al análisis del historial (N4). Es una OverviewCard, no una
         bifurcación antes del hogar: P1 nunca bloqueó a nadie. -->
    <div v-if="entradaGastosFijos.visible" class="entrada">
      <OverviewCard
        etiqueta="Gastos fijos"
        :texto="entradaGastosFijos.titulo"
        :nota="entradaGastosFijos.nota"
        :tag="entradaGastosFijos.tag"
        :destino="toHash('alta')"
        data-testid="entrada-gastos-fijos"
      />
    </div>

    <div class="cards">
      <OverviewCard
        etiqueta="Saldo"
        :valor="saldo"
        :sin-dato="ROTULO_SIN_LEER"
        :nota="moneda ? `${moneda} · al corte del último sync` : 'al corte del último sync'"
        :destino="toHash('movimientos')"
        :cargando="cargando"
      />
      <OverviewCard
        etiqueta="Safe to spend"
        :valor="safeToSpend"
        sin-dato="Todavía no sé"
        :nota="hayDiaDePago ? 'hoy, ya descontado el colchón' : 'falta el día de pago para poder decirlo'"
        :cargando="cargando"
      />
      <!-- Tarjeta y Colchón muestran su cifra y no navegan (R4). -->
      <OverviewCard
        etiqueta="Tarjeta"
        :valor="saldoDeTarjeta ?? undefined"
        :sin-dato="ROTULO_SIN_LEER"
        :nota="notaDeTarjeta"
        :cargando="cargando"
      />
      <OverviewCard
        etiqueta="Próximo pago"
        :texto="proximoPago ?? undefined"
        :sin-dato="ROTULO_SIN_LEER"
        :nota="proximoPago ? 'el próximo cobro que el motor puede predecir' : 'falta configurar el día de pago'"
        :cargando="cargando"
      />
    </div>

    <div class="cols">
      <div class="card">
        <h2 class="h2">Gasto por categoría — este mes</h2>
        <a
          v-for="barra in barras"
          :key="barra.clave"
          class="bar lnk"
          :href="toHash('movimientos', { categoria: barra.clave })"
          data-testid="barra-categoria"
        >
          <span class="bar-nombre">{{ barra.nombre }}</span>
          <span class="track"><i class="fill" :style="{ width: `${barra.ancho}%` }"></i></span>
          <span class="amt tabular">{{ formatoPlata(barra.total) }}</span>
        </a>
        <p v-if="barras.length === 0" class="small">Todavía no hay gasto contable este mes.</p>
        <p class="small nota">
          Las filas en revisión no entran en estos totales, igual que las excluye el motor.
        </p>
      </div>

      <div class="cols-der">
        <div class="card">
          <h2 class="h2">Colchón</h2>
          <div class="bar">
            <span class="bar-nombre" data-testid="colchon-etiqueta">{{ anillo.etiqueta }}</span>
            <span class="track"
              ><i class="fill" :class="anillo.tag === 'ok' ? 'ok' : 'neu'" :style="{ width: `${anillo.ancho}%` }"></i
            ></span>
            <span v-if="anillo.fijado" class="amt tabular">{{ anillo.ancho }} %</span>
            <span v-else class="amt muted">—</span>
          </div>
          <!-- R25: sin objetivo no se dibuja un porcentaje ni un "falta 0,00",
               que se leerían como "ya está". Se dice qué falta y dónde se fija. -->
          <p v-if="!anillo.fijado" class="small" data-testid="colchon-sin-fijar">
            <template v-if="colchon">
              Todavía no fijaste un objetivo, así que no hay contra qué medir lo reservado
              ({{ formatoPlata(colchon.reservado) }}).
              <a class="lnk-acc" :href="toHash('alta')">Fijalo acá.</a>
            </template>
            <template v-else>{{ ROTULO_SIN_LEER }}</template>
          </p>
          <p v-else class="small">
            objetivo {{ formatoPlata(colchon!.objetivo) }} · reservado {{ formatoPlata(colchon!.reservado) }} · falta
            {{ formatoPlata(colchon!.faltante) }}
          </p>
        </div>

        <div class="card">
          <h2 class="h2">Calendario</h2>
          <div class="next">
            <span>Próximo cobro</span
            ><span :class="proximoPago ? 'tabular' : 'muted'">{{ proximoPago ?? ROTULO_SIN_LEER }}</span>
          </div>
          <div class="next">
            <span>Corte de tarjeta</span
            ><span :class="formatoFecha(overview?.card?.issue_date ?? null) ? 'tabular' : 'muted'">{{
              formatoFecha(overview?.card?.issue_date ?? null) ?? ROTULO_SIN_LEER
            }}</span>
          </div>
          <div class="next">
            <span>Vencimiento</span
            ><span :class="formatoFecha(overview?.card?.due_date ?? null) ? 'tabular' : 'muted'">{{
              formatoFecha(overview?.card?.due_date ?? null) ?? ROTULO_SIN_LEER
            }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.topr {
  display: flex;
  align-items: center;
  gap: 10px;
}
.fresh {
  color: var(--apagado);
  font-size: var(--small-size);
  display: flex;
  align-items: center;
  gap: 6px;
}
.chip {
  margin-bottom: 12px;
}
.error {
  border-color: var(--tag-bad-borde);
  margin-bottom: 12px;
}
.alert {
  margin-bottom: 12px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 12px;
}
/* La tarjeta de entrada al análisis va en su propia fila y no como quinta
 * columna: con cinco columnas la cifra de 26px de las otras cuatro se corta, y
 * una cifra cortada es un número equivocado. */
.entrada {
  margin-bottom: 12px;
}
.lnk-acc {
  color: var(--boton-terciario-texto);
}
.cols {
  display: grid;
  grid-template-columns: 1.35fr 1fr;
  gap: 12px;
}
.cols-der {
  display: grid;
  gap: 12px;
  align-content: start;
}
.bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 9px;
  font-size: 13px;
}
.bar-nombre {
  width: 104px;
  flex: none;
  color: var(--texto-nota);
}
.track {
  flex: 1;
  height: 8px;
}
.amt {
  width: 84px;
  text-align: right;
  color: var(--apagado);
  font-size: var(--small-size);
}
.next {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 7px 0;
  border-bottom: 1px solid var(--superficie-suave);
  font-size: 13px;
}
.next:last-child {
  border: 0;
}
.nota {
  margin: 10px 0 0;
}

/*
 * D6, opción A: el Resumen —y sólo el Resumen— tiene diseño chico propio,
 * porque es la superficie que se mira desde el teléfono.
 *
 * Qué cambia y por qué:
 * - Las cuatro tarjetas pasan a dos columnas y después a una. Una cifra de
 *   26px en una columna de 90px se corta, y una cifra cortada es un número
 *   equivocado.
 * - Las dos columnas de abajo se apilan: el gráfico necesita ancho para que
 *   la barra signifique algo.
 * - En la barra de categoría el nombre deja de tener ancho fijo; con 104px
 *   fijos sobre 360px de pantalla no queda barra que mirar.
 * - La cabecera se apila para que el estado del sync no empuje al título.
 */
@media (max-width: 900px) {
  .cards {
    grid-template-columns: repeat(2, 1fr);
  }
  .cols {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .top {
    flex-direction: column;
    gap: 8px;
  }
  .cards {
    grid-template-columns: 1fr;
  }
  .bar-nombre {
    width: auto;
    flex: 1;
    min-width: 0;
  }
  .track {
    flex: 1.2;
  }
  .amt {
    width: auto;
  }
  .alert {
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
}
</style>
