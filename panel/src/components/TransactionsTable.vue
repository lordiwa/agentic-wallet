<script setup lang="ts">
/**
 * `TransactionsTable` — la tabla del ledger, réplica de
 * `c4-tabla-transacciones.html` dentro de `p4-movimientos.html`.
 *
 * Del sistema se toman, tal cual: las columnas, la cabecera en 11px mayúsculas,
 * las cifras tabulares alineadas a la derecha, las etiquetas de estado de la
 * columna *Marcas*, la fila atenuada de lo que el motor ya excluyó y la barra
 * ámbar al margen de lo que está en revisión.
 *
 * Lo que cambia, y por qué (§2.5 pide que la diferencia esté escrita):
 *
 * - **La columna *Acciones* tiene un solo control, y abre el detalle.** Las tres
 *   acciones por fila que dibuja el sistema no sobreviven al MVP: *Regla* iba a
 *   `p6-reglas.html` (eliminada, **M4**), *Preguntar* al chat (diferido, **M2**)
 *   y *Resolver* a la cola de monto, que ya es la pantalla de N3. La única
 *   acción nueva —*¿Qué es esto?*— vive en el detalle, no repetida en cada fila.
 * - **El pie no dice "Mostrando 8 de N" ni tiene *Anterior/Siguiente***: es
 *   *cargar más* (**H20**). El `total` no existe en la ruta salvo cuando se pide
 *   una categoría, y pedirlo sería un `COUNT` por cada tecleo de filtro.
 * - **El monto de una fila en revisión no se dibuja como *Sin leer***. El motor
 *   nunca devuelve `amount: null` (`db/schema.ts` declara `amount REAL NOT
 *   NULL`), así que la fila tiene monto: lo que falta es que alguien lo
 *   confirme. Se dibuja el número con la etiqueta *sin confirmar*, que es la
 *   corrección obligatoria de §2.3 (R6/X8/X11).
 *
 * La tabla **no reinterpreta nada**: reverso, interna y en revisión los decidió
 * el motor (`rules/reconcile.ts`, el pipeline), y acá se rotulan. Tampoco edita:
 * la única escritura sale por `@clasificar`, y la hace la pantalla.
 */
import { computed, ref } from "vue";
import type { Category, TransactionRow } from "../api/types";
import type { Efecto } from "../lib/efecto";
import { motivoSinPregunta, vistaDeFila } from "../lib/movimientos";
import { opcionesDeCategoria } from "../lib/categorias";
import { formatoEntero, formatoPlata } from "../lib/formato";

const props = withDefaults(
  defineProps<{
    filas: TransactionRow[];
    /** La categoría recalculada de la barra, cuando se llegó desde el gráfico.
     * Gana sobre la columna `category` de cada fila. */
    categoria?: Category | null;
    /** La fila abierta, o `null`. La pantalla es la dueña del estado: cerrar el
     * detalle al recargar no puede ser una decisión de la tabla. */
    abierta?: string | number | null;
    /** Qué cambió después de responder (F13/R19). Se dibuja adentro del
     * detalle, que es donde se hizo la pregunta. */
    efecto?: Efecto | null;
    /** Hay una escritura en vuelo: no se responde dos veces la misma fila. */
    ocupada?: boolean;
    cargando?: boolean;
    /** Queda más para traer: dibuja *Cargar más*. */
    hayMas?: boolean;
    cargandoMas?: boolean;
  }>(),
  { categoria: null, abierta: null, efecto: null, ocupada: false, cargando: false, hayMas: false, cargandoMas: false }
);

const emit = defineEmits<{
  abrir: [id: string | number | null];
  clasificar: [fila: TransactionRow, category: Category];
  cargarMas: [];
}>();

/** Cada fila con lo suyo ya resuelto: cómo se dibuja y por qué no se puede
 * preguntar, si es que no se puede. Se arma acá y no en la plantilla para que
 * el `.vue` no tenga una sola decisión adentro. */
const entradas = computed(() =>
  props.filas.map((fila) => ({
    fila,
    vista: vistaDeFila(fila, props.categoria),
    motivo: motivoSinPregunta(fila),
  }))
);

const opciones = computed(() => opcionesDeCategoria());

/** La categoría elegida en el detalle abierto. Se limpia sola al cambiar de
 * fila porque el estado cuelga del id, no del componente. */
const elegida = ref<Category | "">("");

function alternar(id: string | number): void {
  elegida.value = "";
  emit("abrir", props.abierta === id ? null : id);
}

function responder(fila: TransactionRow): void {
  if (elegida.value === "") return;
  emit("clasificar", fila, elegida.value);
}
</script>

<template>
  <div class="card">
    <table data-testid="tabla-movimientos">
      <thead>
        <tr>
          <!-- La flecha de `c4-tabla-transacciones.html`. Es fija y no un
               control: el motor devuelve los más recientes primero y esta
               pantalla no ordena por otra columna. Dibujarla clickeable sería
               ofrecer un orden que nadie sirve. -->
          <th>Fecha <span class="sort" aria-hidden="true">↓</span></th>
          <th>Contraparte</th>
          <th>Tipo</th>
          <th>Dirección</th>
          <th>Categoría</th>
          <th class="r">Monto</th>
          <th>Marcas</th>
          <th class="r">Acciones</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="{ fila, vista, motivo } in entradas" :key="vista.id">
          <tr :class="{ dim: vista.atenuada, flag: vista.marcada }" data-testid="fila-movimiento">
            <td class="muted">{{ vista.fecha }}</td>
            <td class="cp" :class="{ muted: vista.sinContraparte }">{{ vista.contraparte }}</td>
            <td>{{ vista.tipo }}</td>
            <td>{{ vista.direccion }}</td>
            <td :class="{ muted: vista.sinCategoria }">{{ vista.categoria }}</td>
            <td class="r amt" :class="vista.montoClase" data-testid="fila-monto">{{ vista.monto }}</td>
            <td>
              <span v-for="marca in vista.marcas" :key="marca.texto" class="tag" :class="marca.clase">
                {{ marca.texto }}
              </span>
            </td>
            <td class="r">
              <div class="rowacts">
                <button
                  class="btn"
                  type="button"
                  :aria-expanded="abierta === vista.id"
                  data-testid="fila-detalle"
                  @click="alternar(vista.id)"
                >
                  {{ abierta === vista.id ? "Cerrar" : "Detalle" }}
                </button>
              </div>
            </td>
          </tr>

          <!-- El detalle: UNA sola acción nueva, *¿Qué es esto?*, que llama al
               mismo escritor que la cola (H28, segunda puerta del Escenario 1). -->
          <tr v-if="abierta === vista.id" class="det" data-testid="detalle-fila">
            <td colspan="8">
              <div class="det-datos">
                <div>
                  <h3 class="label">Cuándo</h3>
                  <span class="small">{{ vista.fechaCompleta }}</span>
                </div>
                <div>
                  <h3 class="label">Monto</h3>
                  <span class="small tabular">{{ vista.monto }} {{ vista.moneda }}</span>
                </div>
                <div>
                  <h3 class="label">Categoría</h3>
                  <span class="small">{{ vista.categoria }}</span>
                </div>
                <div class="ancho">
                  <h3 class="label">Asunto del correo</h3>
                  <span class="small">{{ fila.raw_subject ?? "—" }}</span>
                </div>
              </div>

              <!-- Sin monto afirmado la fila está fuera de todos los totales, así
                   que decir qué es no movería ninguna barra. Se dice y se deja
                   responder igual: la regla que se escribe vale para el resto de
                   los movimientos de esa contraparte. -->
              <p v-if="vista.sinConfirmar" class="aviso" data-testid="detalle-sin-confirmar">
                Este movimiento está esperando que confirmes su monto, así que hoy no entra a ningún total y
                responder qué es no va a mover el gráfico. Eso se pregunta en
                <a class="lnk-acc" href="#/preguntas?pestana=monto">Preguntas · Monto</a>, y va primero.
              </p>

              <div class="det-acc">
                <template v-if="motivo === null">
                  <label class="sr" :for="`cat-${vista.id}`">Categoría para {{ vista.contraparte }}</label>
                  <span class="det-titulo">¿Qué es esto?</span>
                  <select
                    :id="`cat-${vista.id}`"
                    v-model="elegida"
                    class="inp"
                    :disabled="ocupada"
                    data-testid="detalle-selector"
                  >
                    <option value="" disabled>Elegí qué es</option>
                    <option v-for="opcion in opciones" :key="opcion.clave" :value="opcion.clave">
                      {{ opcion.nombre }}
                    </option>
                  </select>
                  <button
                    class="btn pri"
                    type="button"
                    :disabled="elegida === '' || ocupada"
                    data-testid="detalle-responder"
                    @click="responder(fila)"
                  >
                    Es esto
                  </button>
                </template>
                <p v-else class="small" data-testid="detalle-sin-pregunta">{{ motivo }}</p>
              </div>

              <p v-if="!vista.sinContraparte" class="small pie">
                Tu respuesta escribe una regla sobre <b>{{ vista.contraparte }}</b> y vale para todos sus movimientos,
                los de antes y los que vengan — es la misma respuesta que la cola de Preguntas.
              </p>

              <!-- Qué cambió, con el número, acá mismo (F13/R19). -->
              <div v-if="efecto" class="efecto" :class="efecto.tono" data-testid="detalle-efecto">
                <span class="tag" :class="efecto.tono">{{
                  efecto.tono === "bad" ? "rechazado" : efecto.tono === "neu" ? "sin cambios" : "listo"
                }}</span>
                <div>
                  <b>{{ efecto.titulo }}</b>
                  <p class="small">{{ efecto.detalle }}</p>
                </div>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <div v-if="cargando" class="estado" data-testid="tabla-cargando">
      <span class="sk"></span><span class="sk corta"></span><span class="sk media"></span>
    </div>

    <!-- El estado vacío del sistema: se ofrece limpiar los filtros, no un cero
         engañoso. Quién limpia es la pantalla; acá se dice que no hay nada. -->
    <div v-else-if="filas.length === 0" class="estado vacio" data-testid="tabla-vacia">
      <b>Sin resultados</b>
      <p class="small">No hay movimientos que cumplan lo que pediste.</p>
    </div>

    <!-- *Cargar más*, sin total y sin paginador (H20). -->
    <div v-else class="pag">
      <span class="small tabular" data-testid="tabla-conteo">
        {{ formatoEntero(filas.length) }} {{ filas.length === 1 ? "movimiento" : "movimientos" }} a la vista
      </span>
      <button
        v-if="hayMas"
        class="btn"
        type="button"
        :disabled="cargandoMas"
        data-testid="cargar-mas"
        @click="emit('cargarMas')"
      >
        {{ cargandoMas ? "Trayendo…" : "Cargar más" }}
      </button>
      <span v-else class="small" data-testid="tabla-fin">No queda nada más para traer.</span>
    </div>

    <p class="nota">
      <b>Cero y "sin confirmar" no son lo mismo.</b> Un monto en {{ formatoPlata(0) }} es un valor real y suma; una fila
      sin confirmar tiene monto pero nadie lo afirmó todavía, y queda fuera de todos los totales — igual que la excluye
      el motor. Acá no se edita nada a mano: una corrección pasa por la cola, que deja rastro.
    </p>
  </div>
</template>

<style scoped>
/* La tabla de `c4`, con sus medidas exactas. */
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
th {
  text-align: left;
  font-size: var(--label-size);
  text-transform: uppercase;
  letter-spacing: var(--label-tracking);
  color: var(--apagado);
  font-weight: var(--label-weight);
  padding: 0 12px 8px 0;
  border-bottom: 1px solid var(--linea);
  white-space: nowrap;
}
td {
  padding: 10px 12px 10px 0;
  border-bottom: 1px solid var(--superficie-suave);
  vertical-align: middle;
}
td.r,
th.r {
  text-align: right;
  padding-right: 0;
}
/* La flecha de orden va en el azul de acción, como en `c4`. */
th .sort {
  color: var(--accion);
}
/* Toda cifra de plata es tabular, sin excepción (§2.1). */
.amt {
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.amt.in {
  color: var(--al-dia);
}
.amt.rev {
  text-decoration: line-through;
  color: var(--boton-off-texto);
  font-weight: 400;
}
/* Lo que el motor ya excluyó de los totales: gris y sin peso. */
.dim td {
  background: var(--fondo);
  color: var(--apagado);
}
/* La barra ámbar al margen de lo que está en revisión (`c4`). */
.flag td {
  box-shadow: inset 3px 0 0 var(--atencion);
}
.cp {
  font-weight: 600;
}
.tag + .tag {
  margin-left: 4px;
}
.rowacts {
  display: flex;
  gap: 5px;
  justify-content: flex-end;
}
.rowacts .btn {
  padding: 5px 11px;
  font-size: var(--small-size);
}

/* ---- El detalle ---- */

.det td {
  background: var(--superficie-suave);
  padding: 13px 14px;
}
.det-datos {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  margin-bottom: 12px;
}
.det-datos .ancho {
  flex: 1;
  min-width: 220px;
}
.det-datos h3 {
  margin-bottom: 2px;
}
.det-titulo {
  font-size: 13.5px;
  font-weight: 600;
}
.det-acc {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  padding-top: 12px;
  border-top: 1px solid var(--linea);
}
/* El selector de `p6-reglas.html`, con el radio de control del sistema. */
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
/* La nota del sistema: barra de atención a la izquierda. */
.aviso {
  border-left: 3px solid var(--atencion);
  background: var(--nota-bg);
  padding: 10px 12px;
  border-radius: 0 var(--radio-boton) var(--radio-boton) 0;
  font-size: var(--small-size);
  color: var(--texto-nota);
  margin: 0 0 12px;
}
.lnk-acc {
  color: var(--boton-terciario-texto);
}
.pie {
  margin: 10px 0 0;
  display: block;
}
.efecto {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  background: var(--panel);
  border: 1px solid var(--linea);
  border-radius: var(--radio-tarjeta);
  padding: 11px 13px;
  margin-top: 12px;
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
.sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

/* ---- Estados y pie ---- */

.estado {
  padding: 18px 2px 6px;
}
.estado.vacio {
  text-align: center;
  padding: 26px;
}
.estado.vacio p {
  margin: 3px 0 0;
}
.sk {
  background: var(--superficie-suave);
  border-radius: 5px;
  height: 11px;
  display: block;
  margin: 9px 0;
}
.sk.corta {
  width: 88%;
}
.sk.media {
  width: 94%;
}
.pag {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
  font-size: 13px;
  color: var(--apagado);
}
.nota {
  border-left: 3px solid var(--atencion);
  background: var(--nota-bg);
  padding: 10px 12px;
  border-radius: 0 var(--radio-boton) var(--radio-boton) 0;
  font-size: var(--small-size);
  color: var(--texto-nota);
  margin: 12px 0 0;
}

/*
 * En pantalla chica la tabla no se reflowea a tarjetas: se deja desplazar en
 * horizontal. Ocho columnas convertidas en ocho pares etiqueta/valor son ocho
 * bloques por movimiento, y el ledger deja de leerse de un vistazo — que es lo
 * único que una tabla hace mejor que una lista.
 */
@media (max-width: 900px) {
  table {
    display: block;
    overflow-x: auto;
    white-space: nowrap;
  }
  .pag {
    flex-wrap: wrap;
  }
}
</style>
