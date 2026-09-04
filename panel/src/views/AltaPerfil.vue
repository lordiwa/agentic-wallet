<script setup lang="ts">
/**
 * **Gastos fijos y perfil** — la pantalla del Escenario 2 de Mato, réplica
 * RECORTADA de `p1-alta-perfil.html`.
 *
 *   "entro por primera vez → analiza 3-6 meses anteriores → crea patrón de
 *    gastos fijos → pregunta gastos particulares"
 *
 * El escenario se cumple entero; lo que se recorta es la PANTALLA. Las
 * diferencias con el preview, todas recortes del MVP y ninguna de estilo
 * (§2.5 pide que estén por escrito):
 *
 * - **Se elimina el checklist de 6 pasos.** Cinco de sus seis pasos (env,
 *   Claude, Gmail, sync, huso horario) se resuelven en la terminal de la
 *   máquina donde corre el server, donde el panel no llega. Dibujar un
 *   checklist cuyos ítems nadie puede tildar desde acá es dibujar una promesa
 *   que la interfaz no puede cumplir. Su columna izquierda la ocupa el perfil,
 *   así que la geometría de `.cols` (1fr / 1.25fr) queda igual.
 * - **Dos campos en vez de cinco.** `diasPago` y `colchonObjetivo`, y nada
 *   más. `titular` lo propone el motor leyéndolo del banco —uno escrito a mano
 *   que no matchea deja las transferencias propias contadas como gasto— y el
 *   monto del sueldo viene con los días desde `suggestSalary`. `Moneda` y
 *   `Cuentas` no tienen escritura en el MVP. Ver `onboard/profile.ts`.
 * - **La lista de propuestas reemplaza al bloque `.sug` de cuatro filas.** `p1`
 *   dibuja cuatro renglones con guiones y un único *"Aceptar y precargar"*;
 *   acá hay hasta diez propuestas reales y cada una se confirma o se descarta
 *   sola. Aceptar diez cosas con un botón no es confirmación explícita.
 * - **Un solo botón al final: *Guardar y seguir*.** No hay una pantalla
 *   intermedia que ofrezca ir a la cola: el flujo TERMINA en la cola (fusión de
 *   los pasos 5 y 7 del flujo original). El *"Saltar por ahora"* de `p1` se
 *   queda, y lleva al hogar.
 *
 * **Nada se guarda sin confirmación explícita** (CLAUDE.md, regla 3): el
 * análisis es un `GET`, cada propuesta se confirma de a una, y los dos campos
 * se escriben cuando se pulsa *Guardar y seguir* y no antes. Los campos
 * arrancan con lo que YA está guardado —que el usuario confirmó alguna vez— o
 * vacíos, nunca con un valor plausible inventado.
 *
 * **El freno de los 3 meses** (R33): con menos historial el análisis no se
 * dibuja activo y la pantalla dice cuánto lleva acumulado. Los dos campos del
 * perfil se siguen pudiendo escribir: no dependen del historial.
 */
import { computed, onMounted, ref } from "vue";
import PendienteCard from "../components/PendienteCard.vue";
import RecurringCard from "../components/RecurringCard.vue";
import {
  ErrorDelMotor,
  esNoPortado,
  fetchProfile,
  fetchRecurring,
  postClassify,
  postProfile,
} from "../api/endpoints";
import type { Category, ProfileResponse, RecurringProposalRow, RecurringResponse } from "../api/types";
import { efectoDeClasificar, efectoDeRechazo, type Efecto } from "../lib/efecto";
import { formatoEntero, formatoPlata, parsePlata, plural } from "../lib/formato";
import { toHash } from "../router/ruta";

const perfil = ref<ProfileResponse | null>(null);
const analisis = ref<RecurringResponse | null>(null);
const cargando = ref(true);
const errorCarga = ref<string | null>(null);
/** Este backend todavía no sirve el perfil ni el análisis (`501 no_portado`). */
const pendiente = ref(false);

/** Las propuestas que quedan en pantalla. Confirmar y descartar las sacan. */
const propuestas = ref<RecurringProposalRow[]>([]);
/** El resultado de la última acción, con su número (F13/R19). */
const efecto = ref<Efecto | null>(null);
/** Hay una escritura en vuelo: nada se pulsa dos veces. */
const escribiendo = ref(false);

/* ---- Los dos campos. Texto, porque es lo que el usuario escribe. ---- */

const diasPago = ref("");
const colchon = ref("");
/** El motivo del rechazo del server, tal cual, al lado del campo. */
const errorPerfil = ref<string | null>(null);
const guardado = ref(false);

async function cargar(): Promise<void> {
  try {
    const [datosPerfil, datosAnalisis] = await Promise.all([fetchProfile(), fetchRecurring()]);
    perfil.value = datosPerfil;
    analisis.value = datosAnalisis;
    propuestas.value = [...datosAnalisis.propuestas];
    // Lo ya guardado se muestra; lo que nunca se fijó queda vacío. Un `0` de
    // colchón es "sin fijar" (R25) y un campo con "0" escrito diría lo
    // contrario.
    //
    // La precarga se escribe con `formatoPlata` y no con `String()`: la cifra
    // que sale por acá es la misma que va a volver a entrar por `parsePlata`,
    // y `String(12.345)` es "12.345", que en `es` se lee como doce mil
    // trescientos cuarenta y cinco. Con la coma puesta la ida y la vuelta no
    // tienen dos lecturas (wargaming ronda 2, W10).
    diasPago.value = datosPerfil.dias_pago.join(", ");
    colchon.value = datosPerfil.colchon_fijado ? formatoPlata(datosPerfil.colchon_objetivo) : "";
    errorCarga.value = null;
    pendiente.value = false;
  } catch (err) {
    // "Todavía no leo esto de tu cuenta" no es "el backend se cayó": ver
    // `components/PendienteCard.vue`.
    if (esNoPortado(err)) {
      pendiente.value = true;
      errorCarga.value = null;
    } else {
      pendiente.value = false;
      errorCarga.value = err instanceof Error ? err.message : String(err);
    }
  } finally {
    cargando.value = false;
  }
}

onMounted(() => {
  void cargar();
});

/* ---- El análisis ---- */

const activo = computed(() => analisis.value?.suficiente_historial === true);

/** "2,5 meses" sin arrastrar el ",0" de un entero. */
function meses(cantidad: number): string {
  const texto = Number.isInteger(cantidad)
    ? formatoEntero(cantidad)
    : cantidad.toLocaleString("es", { maximumFractionDigits: 1 });
  return `${texto} ${cantidad === 1 ? "mes" : "meses"}`;
}

const textoFreno = computed(() => {
  const datos = analisis.value;
  if (!datos) return "";
  return `Llevás ${meses(datos.meses_de_historial)} de historial. Con ${meses(
    datos.meses_minimos
  )} puedo leer tus gastos fijos: hace falta ver el mismo cargo en meses distintos para saber que se repite, y con menos que eso una casualidad de almanaque se parece demasiado a un patrón.`;
});

const destinoCola = toHash("preguntas", { pestana: "que-es" });

async function confirmar(propuesta: RecurringProposalRow, category: Category): Promise<void> {
  if (escribiendo.value) return;
  escribiendo.value = true;
  try {
    const respuesta = await postClassify(propuesta.counterparty, category);
    efecto.value = efectoDeClasificar(respuesta);
    propuestas.value = propuestas.value.filter((fila) => fila.pattern !== propuesta.pattern);
  } catch (err) {
    efecto.value = err instanceof ErrorDelMotor ? efectoDeRechazo(err.codigo) : efectoDeRechazo(String(err));
  } finally {
    escribiendo.value = false;
  }
}

/** Descartar no escribe nada: la propuesta se va de acá y la contraparte sigue
 * en la cola, con su pregunta intacta. */
function descartar(propuesta: RecurringProposalRow): void {
  propuestas.value = propuestas.value.filter((fila) => fila.pattern !== propuesta.pattern);
  efecto.value = {
    tono: "neu",
    titulo: `${propuesta.counterparty} no es un gasto fijo.`,
    detalle:
      "No se guardó nada. La contraparte sigue en la cola de preguntas por si querés decir qué es, y de ahí no se va sola.",
  };
}

/* ---- Guardar y seguir ---- */

/** Lo que se va a mandar. Un campo vacío no se manda: vacío es "no lo toqué",
 * no "ponelo en cero". */
const patch = computed(() => {
  const salida: { diasPago?: string[]; colchonObjetivo?: number } = {};

  const dias = diasPago.value
    .split(",")
    .map((parte) => parte.trim())
    .filter((parte) => parte !== "");
  if (dias.length > 0) salida.diasPago = dias;

  const numero = parsePlata(colchon.value);
  if (numero !== null) salida.colchonObjetivo = numero;

  return salida;
});

/**
 * El campo tiene algo escrito y no se entiende como cifra. Es un estado
 * propio, y no "no lo tocó": el wargaming del MVP (W3) encontró que un
 * colchón que no parseaba se caía del patch **en silencio** y la pantalla
 * navegaba igual, dejando al usuario en la cola creyendo que lo había
 * guardado. Vacío sigue siendo "no lo toqué"; ilegible es un error que se dice.
 */
const colchonIlegible = computed(() => colchon.value.trim() !== "" && parsePlata(colchon.value) === null);

const hayQueGuardar = computed(() => Object.keys(patch.value).length > 0);

/**
 * El único botón del final. Guarda lo que haya —si hay— y **sigue a la cola**,
 * que es donde el flujo termina. Si el motor rechaza un campo no se navega: se
 * muestra el motivo tal cual y el usuario corrige.
 */
async function guardarYSeguir(): Promise<void> {
  if (escribiendo.value) return;
  errorPerfil.value = null;

  // Antes de mandar nada: un campo escrito que no se entiende frena el guardado
  // ENTERO. Mandar sólo el otro sería un guardado a medias que el usuario no
  // pidió, y navegar sería prometerle que guardó las dos cosas.
  if (colchonIlegible.value) {
    errorPerfil.value = "colchon_ilegible";
    efecto.value = {
      tono: "bad",
      titulo: "No entendí el colchón.",
      detalle: `Escribí el colchón como una cifra —${formatoPlata(1234.5)}, o 1234.5—. Lo demás quedó sin guardar.`,
    };
    return;
  }

  if (hayQueGuardar.value) {
    escribiendo.value = true;
    try {
      perfil.value = await postProfile(patch.value);
      guardado.value = true;
    } catch (err) {
      errorPerfil.value = err instanceof ErrorDelMotor ? err.codigo : String(err);
      efecto.value = efectoDeRechazo(errorPerfil.value);
      return;
    } finally {
      escribiendo.value = false;
    }
  }

  window.location.hash = destinoCola;
}
</script>

<template>
  <div class="alta">
    <div class="top">
      <div>
        <h1 class="h1">Gastos fijos y perfil</h1>
        <p class="sub">
          Lo que sigue lo leí de tu propio historial. Nada de esto se guarda hasta que lo confirmes.
        </p>
      </div>
      <a class="btn qui" :href="toHash('resumen')" data-testid="alta-saltar">Saltar por ahora</a>
    </div>

    <PendienteCard
      v-if="pendiente"
      titulo="Tu perfil y tus gastos fijos"
      nota="El análisis sale de tu historial: sin leerlo no hay nada que proponerte."
      data-testid="pendiente-alta"
    />

    <div v-if="errorCarga" class="card error" data-testid="alta-error">
      <b>El backend no respondió.</b>
      <p class="small">{{ errorCarga }}</p>
    </div>

    <div v-if="efecto" class="card efecto" :data-tono="efecto.tono" data-testid="alta-efecto">
      <span class="tag" :class="efecto.tono">{{ efecto.titulo }}</span>
      <p class="small">{{ efecto.detalle }}</p>
    </div>

    <div v-if="!pendiente" class="cols">
      <!-- La columna del checklist de `p1`, ocupada por el perfil. -->
      <div class="card" data-testid="alta-perfil">
        <h2 class="h2">Perfil</h2>

        <div class="field">
          <label class="label" for="dias-pago">Día de pago</label>
          <input
            id="dias-pago"
            v-model="diasPago"
            class="inp"
            placeholder="vacío"
            autocomplete="off"
            data-testid="campo-dias-pago"
          />
          <p class="hint">
            Un día (15), varios separados por coma (15, 30) o una ventana (28-30). Sin esto no hay safe-to-spend ni
            próximo cobro: el motor no adivina un día de cobro.
          </p>
        </div>

        <div class="field">
          <label class="label" for="colchon">Colchón objetivo</label>
          <input
            id="colchon"
            v-model="colchon"
            class="inp"
            placeholder="vacío"
            inputmode="decimal"
            autocomplete="off"
            data-testid="campo-colchon"
          />
          <!-- R25 dicho donde se decide. -->
          <p class="hint">
            Cuánto querés no tocar nunca. En cero queda <b>sin fijar</b>, y el anillo del Resumen lo dice así — no como
            un objetivo cumplido.
          </p>
        </div>

        <p v-if="errorPerfil" class="hint mal" data-testid="alta-error-perfil">
          {{ efecto?.detalle }}
        </p>

        <p v-else-if="perfil" class="hint" data-testid="alta-estado-perfil">
          Hoy: día de pago
          <b>{{ perfil.dia_de_pago_fijado ? perfil.dias_pago.join(" · ") : "sin fijar" }}</b>
          · colchón
          <b>{{ perfil.colchon_fijado ? formatoPlata(perfil.colchon_objetivo) : "sin fijar" }}</b>
        </p>

        <div class="note">
          <b>Nunca se escribe un valor que no confirmaste.</b> Los campos arrancan con lo que ya guardaste, o vacíos.
          Sin defaults plausibles, sin sueldo de ejemplo, sin comercios precargados.
        </div>
      </div>

      <div>
        <div class="card cab">
          <h2 class="h2">
            Gastos fijos leídos de tu historial
            <span class="tag neu">mediana, no promedio</span>
          </h2>
          <p v-if="cargando" class="small" data-testid="alta-cargando">cargando…</p>
          <template v-else-if="analisis">
            <p v-if="activo" class="small" data-testid="alta-alcance">
              Son
              {{ plural(propuestas.length, "propuesta", "propuestas") }}
              sobre {{ meses(analisis.meses_de_historial) }} de historial, ordenadas por la plata que mueven.
              <template v-if="analisis.en_la_cola > 0">
                Encontré {{ formatoEntero(analisis.candidatas) }} candidatas y te muestro las que más plata mueven;
                {{ plural(analisis.en_la_cola, "la otra queda", "las otras quedan") }} en la cola de preguntas, que es
                donde se contestan de a una.
              </template>
            </p>
            <p v-else class="small" data-testid="alta-freno">{{ textoFreno }}</p>
          </template>
        </div>

        <!-- Con historial corto el análisis no se dibuja activo (R33). -->
        <div v-if="analisis && !activo && !cargando" class="card freno" data-testid="alta-freno-caja">
          <p class="small">
            Mientras tanto podés fijar los dos campos de la izquierda: no dependen del historial. Y las
            {{ plural(analisis.candidatas, "contraparte que se repite está", "contrapartes que se repiten están") }}
            esperando en la cola de preguntas.
          </p>
          <a class="btn" :href="destinoCola">Ir a la cola</a>
        </div>

        <template v-else-if="activo">
          <RecurringCard
            v-for="(propuesta, indice) in propuestas"
            :key="propuesta.pattern"
            :propuesta="propuesta"
            :posicion="indice + 1"
            :total="propuestas.length"
            :ocupada="escribiendo"
            @confirmar="(category) => confirmar(propuesta, category)"
            @descartar="descartar(propuesta)"
          />

          <div v-if="propuestas.length === 0" class="card vacio" data-testid="alta-vacio">
            <b>No queda ninguna propuesta.</b>
            <p class="small">
              Las que confirmaste ya tienen su regla escrita. El resto de tus movimientos se contesta en la cola, de a
              una contraparte por vez.
            </p>
          </div>
        </template>
      </div>
    </div>

    <!-- El final del flujo: un solo botón, y termina en la cola. -->
    <div class="pie">
      <button
        class="btn pri"
        type="button"
        :disabled="escribiendo"
        data-testid="alta-guardar-y-seguir"
        @click="guardarYSeguir"
      >
        Guardar y seguir
      </button>
      <span class="small">
        {{
          hayQueGuardar
            ? "Guarda los dos campos y te lleva a la cola de preguntas."
            : "Te lleva a la cola de preguntas. No hay nada escrito para guardar."
        }}
      </span>
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
.error {
  border-color: var(--tag-bad-borde);
  margin-bottom: 12px;
}
.efecto {
  margin-bottom: 12px;
}
.efecto .small {
  margin: 8px 0 0;
}
/* La rejilla de `p1-alta-perfil.html`, con el perfil donde iba el checklist. */
.cols {
  display: grid;
  grid-template-columns: 1fr 1.25fr;
  gap: 12px;
  align-items: start;
}
.cab {
  margin-bottom: 12px;
}
.cab .h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.field {
  margin-bottom: 13px;
}
/* El campo de `p1`: radio de botón, borde de línea, placeholder apagado. */
.inp {
  width: 100%;
  border: 1px solid var(--linea);
  border-radius: var(--radio-boton);
  padding: 8px 11px;
  font: inherit;
  font-size: 14px;
  color: var(--tinta);
  background: var(--panel);
}
.hint {
  font-size: 12px;
  color: var(--apagado);
  margin: 5px 0 0;
}
.hint.mal {
  color: var(--tag-bad-texto);
}
/* La nota amarilla de `p1`. */
.note {
  border-left: 3px solid var(--atencion);
  background: var(--nota-bg);
  padding: 10px 12px;
  border-radius: 0 var(--radio-boton) var(--radio-boton) 0;
  font-size: var(--small-size);
  color: var(--texto-nota);
  margin-top: 12px;
}
.freno,
.vacio {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.vacio {
  display: block;
}
.freno .small {
  margin: 0;
}
.pie {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  flex-wrap: wrap;
}

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
  .freno {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
