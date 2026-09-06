<script setup lang="ts">
/**
 * Sobres: cuánta plata hay apartada, en qué, y de dónde sale un sobre nuevo.
 *
 * Réplica de `p9-ahorro.html` — el anillo del colchón con su lista de cifras a
 * la derecha (`.ring` / `.rl`), las metas como barras (`.goal` / `.gh`), el
 * editor de `.inp` + `.btn.pri`, la nota ámbar.
 *
 * Lo que se toma y lo que no (§2.5 pide que la diferencia esté escrita):
 *
 * - **El panel del agente no se dibuja.** `p9` reserva media pantalla para
 *   *"lo que responde el chat cuando se le pide mirar el historial"*, rotulado
 *   como no-cálculo. El chat no entra al MVP, y una tarjeta que no puede
 *   contestar es peor que no estar.
 * - **El histórico de aportes tampoco**, y por lo que la propia tarjeta decía:
 *   sale de tablas que *"hoy no tienen endpoint HTTP"*. Sigue sin tenerlo. Lo
 *   que sí hay ahora es la lista de sobres, que es la mitad que faltaba.
 * - **La tarjeta "Fijar objetivo" de `p9` se funde con el editor de cada
 *   sobre**: fijar la meta del colchón es fijar la meta de un sobre, y tener
 *   dos formularios para lo mismo es cómo terminan discrepando.
 *
 * Y la afirmación que esta pantalla tiene que hacer en voz alta, porque es la
 * única que puede: **el sobre de Emergencia es el colchón**. La misma plata que
 * el Resumen descuenta, no una copia. Un sobre nuevo, en cambio, no mueve una
 * sola cifra del Resumen — es contabilidad. Si la pantalla no lo dijera, la
 * primera pregunta al ver el safe-to-spend quieto sería si algo se rompió.
 */
import { computed, onMounted, ref, watch } from "vue";
import { ErrorDelMotor, ajustarSobre, crearSobre, fetchSobres } from "../api/endpoints";
import type { Sobre } from "../api/types";
import { useRefresh } from "../composables/useRefresh";
import { formatoPlata, parsePlata } from "../lib/formato";
import { mensajeDeError, vistaSobres } from "../lib/sobres";

const sobres = ref<Sobre[]>([]);
const total = ref(0);
const moneda = ref("");
const cargando = ref(true);
const errorCarga = ref<string | null>(null);

const reloj = useRefresh();

async function cargar(): Promise<void> {
  try {
    const respuesta = await fetchSobres();
    sobres.value = respuesta.sobres;
    total.value = respuesta.total;
    moneda.value = respuesta.moneda;
    errorCarga.value = null;
  } catch (err) {
    // No se dibuja el último valor conocido con cara de actual: si el backend
    // no responde, se dice.
    errorCarga.value = err instanceof Error ? err.message : String(err);
  } finally {
    cargando.value = false;
  }
}

watch(reloj.tick, () => {
  void cargar();
});
onMounted(() => {
  void cargar();
});

const vistas = computed(() => vistaSobres(sobres.value));
const colchon = computed(() => vistas.value.find((sobre) => sobre.sistema) ?? null);
const propios = computed(() => vistas.value.filter((sobre) => !sobre.sistema));

/** El estado del colchón, con las mismas tres respuestas que el sistema pinta:
 * financiado, a medias, y —R25— sin meta contra la que medirse. */
const estadoColchon = computed(() => {
  const vista = colchon.value;
  if (vista === null || !vista.fijado) return { texto: "sin meta fijada", clase: "neu" };
  if (vista.faltante === 0) return { texto: "financiado", clase: "ok" };
  return { texto: "parcialmente financiado", clase: "warn" };
});

/** El perímetro del anillo de `p9`: r=50 → 2πr, redondeado como en la tarjeta. */
const PERIMETRO = 314;
const aro = computed(() => ({
  ancho: colchon.value?.ancho ?? 0,
  // Cuánto del trazo queda SIN pintar. Con el objetivo sin fijar es el
  // perímetro entero: un anillo vacío, que es lo que "no hay contra qué medir"
  // se ve.
  hueco: PERIMETRO - (PERIMETRO * (colchon.value?.ancho ?? 0)) / 100,
}));

/* ---- Crear un sobre ---- */

const nuevoNombre = ref("");
const nuevoMonto = ref("");
const nuevaMeta = ref("");
const creando = ref(false);
const errorAlta = ref<string | null>(null);

/**
 * Un campo de plata vacío es **ausente**, no cero, y ésa es la diferencia que
 * decide qué se manda: sin monto el sobre arranca en cero porque el motor lo
 * decide, no porque el panel haya mandado un cero que nadie escribió. Un texto
 * que no es una cifra tampoco se manda: se rechaza acá y se dice.
 */
function cifraOpcional(texto: string): { ok: true; valor?: number } | { ok: false } {
  if (texto.trim() === "") return { ok: true };
  const valor = parsePlata(texto);
  if (valor === null || valor < 0) return { ok: false };
  return { ok: true, valor };
}

async function crear(): Promise<void> {
  if (creando.value) return;
  errorAlta.value = null;

  const monto = cifraOpcional(nuevoMonto.value);
  const meta = cifraOpcional(nuevaMeta.value);
  if (!monto.ok || !meta.ok) {
    errorAlta.value = "Revisá el monto: tiene que ser una cifra, sin signo.";
    return;
  }
  if (nuevoNombre.value.trim() === "") {
    errorAlta.value = mensajeDeError("nombre_vacio");
    return;
  }

  creando.value = true;
  try {
    await crearSobre({
      nombre: nuevoNombre.value,
      ...(monto.valor === undefined ? {} : { monto: monto.valor }),
      ...(meta.valor === undefined ? {} : { objetivo: meta.valor }),
    });
    nuevoNombre.value = "";
    nuevoMonto.value = "";
    nuevaMeta.value = "";
    await cargar();
  } catch (err) {
    errorAlta.value =
      err instanceof ErrorDelMotor ? mensajeDeError(err.codigo) : "No se pudo crear el sobre.";
  } finally {
    creando.value = false;
  }
}

/* ---- Ajustar un sobre ---- */

const abierto = ref<string | null>(null);
const aporte = ref("");
const metaEditada = ref("");
const nombreEditado = ref("");
const guardando = ref(false);
const errorAjuste = ref<string | null>(null);

function abrir(id: string): void {
  const vista = vistas.value.find((sobre) => sobre.id === id);
  abierto.value = abierto.value === id ? null : id;
  aporte.value = "";
  errorAjuste.value = null;
  metaEditada.value = vista?.fijado ? String(vista.objetivo) : "";
  nombreEditado.value = vista?.nombre ?? "";
}

async function guardar(id: string): Promise<void> {
  if (guardando.value) return;
  const vista = vistas.value.find((sobre) => sobre.id === id);
  if (vista === undefined) return;
  errorAjuste.value = null;

  const patch: { nombre?: string; aporte?: number; objetivo?: number | null } = {};

  // El aporte admite signo: en negativo es un retiro. Es el único campo de
  // plata del panel donde el menos significa algo.
  if (aporte.value.trim() !== "") {
    const valor = parsePlata(aporte.value);
    if (valor === null) {
      errorAjuste.value = "El aporte tiene que ser una cifra. En negativo es un retiro.";
      return;
    }
    patch.aporte = valor;
  }

  const meta = cifraOpcional(metaEditada.value);
  if (!meta.ok) {
    errorAjuste.value = "La meta tiene que ser una cifra, sin signo.";
    return;
  }
  // Vaciar el campo teniendo meta es borrarla (`null` explícito), que no es lo
  // mismo que no tocarla.
  if (meta.valor !== undefined && meta.valor !== vista.objetivo) patch.objetivo = meta.valor;
  else if (meta.valor === undefined && vista.fijado) patch.objetivo = null;

  if (!vista.sistema && nombreEditado.value.trim() !== "" && nombreEditado.value.trim() !== vista.nombre) {
    patch.nombre = nombreEditado.value;
  }

  if (Object.keys(patch).length === 0) {
    errorAjuste.value = mensajeDeError("sin_cambios");
    return;
  }

  guardando.value = true;
  try {
    await ajustarSobre(id, patch);
    abierto.value = null;
    await cargar();
  } catch (err) {
    errorAjuste.value =
      err instanceof ErrorDelMotor ? mensajeDeError(err.codigo) : "No se pudo guardar el ajuste.";
  } finally {
    guardando.value = false;
  }
}
</script>

<template>
  <div class="sobres">
    <div class="top">
      <div>
        <h1 class="h1">Sobres</h1>
        <p class="sub">
          Cuánto hay apartado y en qué. El de Emergencia es el colchón: la misma plata que el Resumen
          descuenta del safe-to-spend, no una copia.
        </p>
      </div>
      <span class="small tabular" data-testid="sobres-total">
        {{ formatoPlata(total) }}<template v-if="moneda"> {{ moneda }}</template> apartados
      </span>
    </div>

    <div v-if="errorCarga" class="card error" data-testid="sobres-error">
      <b>El backend no respondió.</b>
      <p class="small">{{ errorCarga }}</p>
    </div>

    <div class="cols">
      <div class="cols-izq">
        <div class="card" data-testid="tarjeta-colchon">
          <h2 class="h2">Emergencia — el colchón</h2>
          <div class="ring">
            <svg viewBox="0 0 120 120" role="img" aria-label="Progreso del colchón">
              <circle class="aro-fondo" cx="60" cy="60" r="50" fill="none" stroke-width="14" />
              <circle
                class="aro-lleno"
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke-width="14"
                stroke-linecap="round"
                :stroke-dasharray="PERIMETRO"
                :stroke-dashoffset="aro.hueco"
                transform="rotate(-90 60 60)"
              />
              <!-- R25: sin meta no se dibuja un porcentaje. Un "0 %" y un
                   "todavía no fijaste objetivo" son dos afirmaciones distintas
                   y sólo la segunda es cierta. -->
              <text v-if="colchon?.fijado" class="aro-cifra" x="60" y="58" text-anchor="middle">
                {{ aro.ancho }}%
              </text>
              <text v-else class="aro-cifra" x="60" y="58" text-anchor="middle">—</text>
              <text class="aro-nota" x="60" y="76" text-anchor="middle">
                {{ colchon?.fijado ? "financiado" : "sin meta" }}
              </text>
            </svg>
            <div class="rl">
              <div>
                <span class="muted">Objetivo</span>
                <b v-if="colchon?.fijado" class="tabular">{{ formatoPlata(colchon.objetivo) }}</b>
                <span v-else class="muted">sin fijar</span>
              </div>
              <div>
                <span class="muted">Reservado</span>
                <b class="tabular" data-testid="colchon-reservado">{{ formatoPlata(colchon?.monto ?? 0) }}</b>
              </div>
              <div>
                <span class="muted">Faltante</span>
                <b v-if="colchon?.fijado" class="tabular">{{ formatoPlata(colchon.faltante) }}</b>
                <span v-else class="muted">—</span>
              </div>
              <div>
                <span class="muted">Estado</span>
                <span class="tag" :class="estadoColchon.clase">{{ estadoColchon.texto }}</span>
              </div>
            </div>
          </div>
          <div class="acts">
            <button class="btn" type="button" data-testid="ajustar-colchon" @click="abrir('colchon')">
              {{ abierto === "colchon" ? "Cerrar" : "Ajustar" }}
            </button>
          </div>
          <form v-if="abierto === 'colchon'" class="editor" @submit.prevent="guardar('colchon')">
            <div>
              <label for="colchon-aporte">Aporte o retiro</label>
              <input id="colchon-aporte" v-model="aporte" class="inp" placeholder="200 o -50" />
            </div>
            <div>
              <label for="colchon-meta">Objetivo</label>
              <input id="colchon-meta" v-model="metaEditada" class="inp" placeholder="vacío" />
            </div>
            <button class="btn pri" type="submit" :disabled="guardando">Guardar</button>
          </form>
          <p v-if="abierto === 'colchon' && errorAjuste" class="small falla" data-testid="colchon-error">
            {{ errorAjuste }}
          </p>
          <p class="note">
            <b>El colchón es el piso.</b> El safe-to-spend se calcula descontándolo: subirlo baja lo
            disponible de hoy, y eso se ve en el Resumen apenas se guarda.
          </p>
        </div>

        <div class="card" data-testid="tarjeta-sobres">
          <h2 class="h2">Tus sobres</h2>

          <p v-if="cargando" class="small">Leyendo…</p>

          <div
            v-for="sobre in propios"
            :key="sobre.id"
            class="goal"
            data-testid="sobre"
            :data-sobre="sobre.id"
          >
            <div class="gh">
              <b>{{ sobre.nombre }}</b>
              <span class="tabular">
                {{ formatoPlata(sobre.monto) }}
                <span v-if="sobre.fijado" class="muted">de {{ formatoPlata(sobre.objetivo) }}</span>
                <span v-else class="muted">· sin meta</span>
              </span>
            </div>
            <span class="track"><i class="fill" :class="sobre.fill" :style="{ width: `${sobre.ancho}%` }"></i></span>
            <div class="acts">
              <button class="btn qui" type="button" @click="abrir(sobre.id)">
                {{ abierto === sobre.id ? "Cerrar" : "Ajustar" }}
              </button>
            </div>
            <form v-if="abierto === sobre.id" class="editor" @submit.prevent="guardar(sobre.id)">
              <div>
                <label :for="`${sobre.id}-nombre`">Nombre</label>
                <input :id="`${sobre.id}-nombre`" v-model="nombreEditado" class="inp" />
              </div>
              <div>
                <label :for="`${sobre.id}-aporte`">Aporte o retiro</label>
                <input :id="`${sobre.id}-aporte`" v-model="aporte" class="inp" placeholder="200 o -50" />
              </div>
              <div>
                <label :for="`${sobre.id}-meta`">Meta</label>
                <input :id="`${sobre.id}-meta`" v-model="metaEditada" class="inp" placeholder="vacío" />
              </div>
              <button class="btn pri" type="submit" :disabled="guardando">Guardar</button>
            </form>
            <p v-if="abierto === sobre.id && errorAjuste" class="small falla" data-testid="sobre-error">
              {{ errorAjuste }}
            </p>
          </div>

          <!-- Vacío es vacío: no hay sobres de ejemplo. Cuáles tiene una
               persona lo decide ella (CLAUDE.md regla 3). -->
          <p v-if="!cargando && propios.length === 0" class="empty" data-testid="sobres-vacio">
            Todavía no creaste ningún sobre. El de Emergencia está siempre: es el colchón.
          </p>
        </div>
      </div>

      <div class="cols-der">
        <div class="card">
          <h2 class="h2">Crear un sobre</h2>
          <form class="alta" @submit.prevent="crear">
            <div>
              <label for="sobre-nombre">Nombre</label>
              <input id="sobre-nombre" v-model="nuevoNombre" class="inp" placeholder="FlexiAhorro" />
            </div>
            <div>
              <label for="sobre-monto">Cuánto hay hoy (opcional)</label>
              <input id="sobre-monto" v-model="nuevoMonto" class="inp" placeholder="vacío" />
            </div>
            <div>
              <label for="sobre-meta">Meta (opcional)</label>
              <input id="sobre-meta" v-model="nuevaMeta" class="inp" placeholder="vacío" />
            </div>
            <button class="btn pri" type="submit" :disabled="creando" data-testid="crear-sobre">
              {{ creando ? "Creando…" : "Crear sobre" }}
            </button>
          </form>
          <p v-if="errorAlta" class="small falla" data-testid="alta-error">{{ errorAlta }}</p>
          <p class="note acc">
            <b>Un sobre es contabilidad, no un movimiento.</b> Crearlo o ajustarlo no mueve plata en
            el banco ni cambia el safe-to-spend — sólo el de Emergencia lo hace, porque el motor lo
            descuenta. Sin monto, el sobre arranca en cero.
          </p>
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
  margin-bottom: 14px;
}
.error {
  border-color: var(--tag-bad-borde);
  margin-bottom: 12px;
}
.falla {
  color: var(--falla);
  margin: 8px 0 0;
}
.cols {
  display: grid;
  grid-template-columns: 1.2fr 1fr;
  gap: 12px;
  align-items: start;
}
.cols-izq,
.cols-der {
  display: grid;
  gap: 12px;
  align-content: start;
}
.ring {
  display: flex;
  align-items: center;
  gap: 20px;
}
.ring svg {
  width: 132px;
  height: 132px;
  flex: none;
}
/* El anillo pide sus colores por el rol, igual que todo el panel: el hex vive
   una sola vez en `tokens.css`. Por eso son clases y no atributos `stroke`. */
.aro-fondo {
  stroke: var(--superficie-suave);
}
.aro-lleno {
  stroke: var(--al-dia);
}
.aro-cifra {
  font-size: 25px;
  font-weight: 640;
  fill: var(--tinta);
  font-family: var(--fuente);
}
.aro-nota {
  font-size: 10.5px;
  fill: var(--apagado);
  font-family: var(--fuente);
}
.rl {
  flex: 1;
}
.rl div {
  display: flex;
  justify-content: space-between;
  gap: 26px;
  padding: 6px 0;
  border-bottom: 1px solid var(--superficie-suave);
  font-size: 13.5px;
}
.rl div:last-child {
  border: 0;
}
.rl b {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.goal {
  padding: 11px 0;
  border-bottom: 1px solid var(--superficie-suave);
}
.goal:last-of-type {
  border: 0;
  padding-bottom: 0;
}
.gh {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 13.5px;
  margin-bottom: 6px;
}
.gh b {
  font-weight: 600;
}
.editor {
  display: flex;
  gap: 9px;
  align-items: flex-end;
  flex-wrap: wrap;
  margin-top: 10px;
}
.alta {
  display: grid;
  gap: 10px;
}
.empty {
  border: 1px dashed var(--linea);
  border-radius: var(--radio-etiqueta);
  padding: 16px;
  text-align: center;
  color: var(--apagado);
  font-size: var(--small-size);
}
.acts {
  margin-top: 8px;
}

/* Igual que el Resumen (D6): en pantalla chica las dos columnas se apilan. El
   anillo no se achica —una cifra de 25px adentro de un círculo más chico deja
   de leerse— así que pasa arriba de su lista. */
@media (max-width: 900px) {
  .cols {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .top {
    flex-direction: column;
    gap: 8px;
  }
  .ring {
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
  }
}
</style>
