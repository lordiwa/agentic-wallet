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
import { fetchClassifyProgress, fetchOverview, fetchSyncStatus, postSync } from "../api/endpoints";
import type { ClassifyProgressResponse, OverviewResponse, SyncStatusResponse, SyncTriggerResponse } from "../api/types";
import { DEFAULT_REFRESH_MS, SYNC_REFRESH_MS, useRefresh } from "../composables/useRefresh";
import { barrasDeCategoria } from "../lib/categorias";
import { timeAgo } from "../lib/freshness";
import { ROTULO_SIN_LEER, formatoEntero, formatoFecha, formatoPlata, plural } from "../lib/formato";
import { tagSync, vistaSync, type Backlog, type FallaSync } from "../lib/sync-estado";
import { toHash } from "../router/ruta";

const overview = ref<OverviewResponse | null>(null);
const estadoSync = ref<SyncStatusResponse | null>(null);
const cola = ref<ClassifyProgressResponse | null>(null);
const cargando = ref(true);
const errorCarga = ref<string | null>(null);

/** Esta pestaña disparó un lote y todavía no volvió. */
const enVuelo = ref(false);
const falla = ref<FallaSync | null>(null);
/** Los ids del último lote, que es a lo que se acota el aviso de categoría. */
const ultimoLote = ref<number[]>([]);

const reloj = useRefresh();

async function cargar(): Promise<void> {
  try {
    const [datos, sync, progreso] = await Promise.all([fetchOverview(), fetchSyncStatus(), fetchClassifyProgress()]);
    overview.value = datos;
    estadoSync.value = sync;
    cola.value = progreso;
    errorCarga.value = null;
  } catch (err) {
    // No se dibuja el último valor conocido con cara de actual (`c3`): si el
    // backend no responde, se dice.
    errorCarga.value = err instanceof Error ? err.message : String(err);
  } finally {
    cargando.value = false;
  }
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

const actualizado = computed(() =>
  reloj.lastRefreshAt.value === null ? null : timeAgo(reloj.lastRefreshAt.value.toISOString())
);

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

const tarjeta = computed(() => overview.value?.card_status ?? null);
const colchon = computed(() => overview.value?.buffer_status ?? null);
const colchonAncho = computed(() => {
  const datos = colchon.value;
  if (!datos || datos.objetivo <= 0) return 0;
  return Math.min(100, Math.round((datos.reservado / datos.objetivo) * 100));
});

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
        :valor="tarjeta?.saldoCorte"
        :sin-dato="ROTULO_SIN_LEER"
        :nota="
          tarjeta
            ? `mínimo ${formatoPlata(tarjeta.minimo)} · fecha máxima ${formatoFecha(tarjeta.fechaMaxima) ?? ROTULO_SIN_LEER}`
            : 'no hay resumen de tarjeta leído'
        "
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
            <span class="bar-nombre">{{ colchon?.financiado ? "Financiado" : "Sin financiar" }}</span>
            <span class="track"><i class="fill ok" :style="{ width: `${colchonAncho}%` }"></i></span>
            <span class="amt tabular">{{ colchonAncho }} %</span>
          </div>
          <p class="small">
            <template v-if="colchon">
              objetivo {{ formatoPlata(colchon.objetivo) }} · reservado {{ formatoPlata(colchon.reservado) }} · falta
              {{ formatoPlata(colchon.faltante) }}
            </template>
            <template v-else>{{ ROTULO_SIN_LEER }}</template>
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
