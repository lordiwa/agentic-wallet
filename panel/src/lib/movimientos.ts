/**
 * La mecánica de la pantalla de Movimientos: **qué se le pide al motor y cómo
 * se lee una fila**. Igual que `lib/cola.ts`, acá no se calcula plata — los
 * montos, la categoría recalculada y el conteo de la barra llegan del motor
 * (regla 4 de §2.3 del plan). Lo que se decide acá es la traducción entre los
 * dos filtros de la pantalla y los parámetros de `GET /api/transactions`, y qué
 * marcas lleva cada fila.
 *
 * Vive fuera del componente porque son reglas con nombre y con test: adentro de
 * un `.vue` no se pueden probar sin montar un navegador.
 */
import type { Category, TransactionRow, TransactionsQuery } from "../api/types";
import { nombreCategoria } from "./categorias";
import { ROTULO_SIN_CONFIRMAR, formatoFecha, formatoPlata } from "./formato";

/**
 * Cuántas filas trae cada pedido.
 *
 * **Sin total y sin paginador** (H20): `offset` ya existe en el motor
 * (`api/queries.ts`), lo que falta es el `total`, y con *cargar más* no hace
 * falta pedirlo. Cincuenta es lo que entra en una pantalla de tabla sin que el
 * primer pedido tarde: la cola se pagina de a 20 porque cada elemento es una
 * tarjeta con tres cifras; acá cada elemento es una fila.
 */
export const TAMANO_MOVIMIENTOS = 50;

/** El tope que acepta el schema del server (`transactionsQuerySchema`). Pedir
 * más es un 400, así que el recargado post-escritura se acota acá. */
export const LIMITE_MAXIMO = 500;

/** Los valores que viajan en `?direction=`. `""` es "las dos", no un valor. */
export type Direccion = "" | "in" | "out";

/**
 * **Los dos filtros de la pantalla, y nada más** (criterio 2): un rango de
 * fechas y entrada/salida. Los otros cuatro controles de la `FilterBar` del
 * sistema no se construyen porque no tienen respaldo — categoría como
 * `WHERE category = ?` estaba mal planteado (H21, ver `categoriaPedida`), tipo
 * multi-selección e *Interna* como dirección (H22) y el autocompletar de
 * contrapartes (H23).
 */
export interface FiltrosMovimientos {
  /** `YYYY-MM-DD` del `<input type="date">`. `""` es "sin fijar". */
  desde: string;
  hasta: string;
  direccion: Direccion;
}

export const SIN_FILTROS: FiltrosMovimientos = { desde: "", hasta: "", direccion: "" };

export function hayFiltros(filtros: FiltrosMovimientos): boolean {
  return filtros.desde !== "" || filtros.hasta !== "" || filtros.direccion !== "";
}

/** Cuántos de los dos filtros están puestos — el "filtros aplicados: 2" de
 * `p4-movimientos.html`. El rango cuenta como uno solo aunque tenga dos campos:
 * es un filtro con dos extremos, no dos filtros. */
export function filtrosAplicados(filtros: FiltrosMovimientos): number {
  return (filtros.desde !== "" || filtros.hasta !== "" ? 1 : 0) + (filtros.direccion !== "" ? 1 : 0);
}

export interface ConsultaOpciones {
  /** La categoría **recalculada** de la barra del gráfico, si se llegó desde
   * una. Cuando viene, los dos filtros no van: ver `categoriaPedida`. */
  categoria?: Category | null;
  limite?: number;
  offset?: number;
}

/**
 * Los parámetros del pedido.
 *
 * **Las dos fechas van como días pelados**, y el motor las resuelve.
 *
 * Antes el extremo de arriba se cerraba acá con `T23:59:59.999Z` — un instante
 * **UTC**— porque `ts` es un instante ISO y `to=2026-09-30` dejaba afuera el día
 * 30 entero. Eso arreglaba el corte y creaba el otro: todo el motor bucketea por
 * **día local** (offset configurable), así que la ventana quedaba corrida las
 * horas del offset en los dos extremos y la lista perdía en silencio las
 * compras de la noche del último día. Sobre el ledger real, 233 de 1140 filas
 * caen en un día distinto del que el Resumen les asigna (wargaming ronda 3,
 * W26).
 *
 * El panel no puede resolverlo: no sabe el offset del server. Y no tiene que
 * saberlo — **qué es un día lo decide el motor**, como todo lo demás acá
 * (regla 4 de §2.3 del plan). `api/routes.ts` interpreta un `YYYY-MM-DD` pelado
 * como el día local completo.
 */
export function consultaDe(filtros: FiltrosMovimientos, opciones: ConsultaOpciones = {}): TransactionsQuery {
  const limit = Math.min(opciones.limite ?? TAMANO_MOVIMIENTOS, LIMITE_MAXIMO);
  const offset = opciones.offset ?? 0;

  // Con categoría, la lista ES la selección de la barra: el motor la arma
  // recalculando sobre el mes que la barra dibujó, y mandarle además un rango o
  // una dirección la volvería otro conjunto — el conteo dejaría de coincidir
  // con el que la barra contó, que es exactamente lo que H21 existe para
  // evitar.
  if (opciones.categoria) {
    return { category: opciones.categoria, limit, offset };
  }

  return {
    ...(filtros.desde === "" ? {} : { from: filtros.desde }),
    ...(filtros.hasta === "" ? {} : { to: filtros.hasta }),
    ...(filtros.direccion === "" ? {} : { direction: filtros.direccion }),
    limit,
    offset,
  };
}

/**
 * La categoría que llega por el hash (`#/movimientos?categoria=salud`), validada
 * contra el glosario cerrado del motor. Lo que no está en el glosario no es una
 * categoría: es texto en una URL, y se ignora en vez de mandarse al server para
 * que lo rechace con un 400.
 */
const CATEGORIAS: readonly string[] = [
  "comida",
  "transporte",
  "salud",
  "mascota",
  "servicios",
  "recarga",
  "efectivo",
  "transferencia_persona",
  "suscripcion",
  "otros",
];

export function categoriaPedida(valor: string | undefined): Category | null {
  if (!valor) return null;
  return CATEGORIAS.includes(valor) ? (valor as Category) : null;
}

/** Una etiqueta de la columna *Marcas*, con la clase `.tag` del sistema. */
export interface Marca {
  clase: "ok" | "warn" | "neu" | "acc" | "bad";
  texto: string;
}

/** Cómo se dibuja una fila. Ninguno de estos campos es una decisión nueva
 * sobre el movimiento: son los que el motor ya tomó, traducidos. */
export interface VistaFila {
  /** Opaco: entero del server local o `gmail_msg_id` de las funciones. */
  id: string | number;
  fecha: string;
  fechaCompleta: string;
  contraparte: string;
  sinContraparte: boolean;
  tipo: string;
  direccion: string;
  categoria: string;
  sinCategoria: boolean;
  monto: string;
  moneda: string;
  /** La clase de la cifra en `c4`: `in` verde para una entrada, `rev` tachada
   * para un reverso. */
  montoClase: "" | "in" | "rev";
  /** Fila gris: el motor ya la excluyó de los totales por reverso o interna. */
  atenuada: boolean;
  /** La barra ámbar al margen de `c4`: está en revisión. */
  marcada: boolean;
  sinConfirmar: boolean;
  marcas: Marca[];
}

const DIRECCIONES: Record<string, string> = { in: "entrada", out: "salida" };

/**
 * Una fila, lista para dibujar.
 *
 * `categoriaRecalculada` es la de la barra cuando se llegó desde el gráfico, y
 * **gana sobre la columna `category`**. No es un capricho: el gráfico recalcula
 * con `categorize()` + las reglas del usuario y no lee esa columna, que puede
 * estar vieja o sin backfill (`strategy/spending.ts`). Mostrar la columna en una
 * lista que salió del recálculo dibujaría "otros" adentro de la lista de Salud.
 */
export function vistaDeFila(fila: TransactionRow, categoriaRecalculada: Category | null = null): VistaFila {
  const interna = fila.is_internal === 1;
  const reverso = fila.is_reversed === 1;
  const sinConfirmar = fila.needs_review === 1;
  const sinContraparte = fila.counterparty === null || fila.counterparty.trim() === "";
  const clave = categoriaRecalculada ?? fila.category;

  const marcas: Marca[] = [];
  if (sinConfirmar) marcas.push({ clase: "warn", texto: ROTULO_SIN_CONFIRMAR.toLowerCase() });
  if (reverso) marcas.push({ clase: "neu", texto: "reverso" });
  if (interna) marcas.push({ clase: "acc", texto: "interna" });
  if (sinContraparte) marcas.push({ clase: "neu", texto: "sin contraparte" });
  // Regla 1 de §2.3: cero es un monto válido y se dice en voz alta, para que
  // nadie lo lea como "no pude leerlo".
  if (fila.amount === 0) marcas.push({ clase: "neu", texto: "monto cero válido" });

  return {
    id: fila.id,
    fecha: formatoFecha(fila.ts) ?? "—",
    fechaCompleta: fila.ts,
    contraparte: sinContraparte ? "sin contraparte" : (fila.counterparty as string),
    sinContraparte,
    tipo: fila.type,
    direccion: interna ? "interna" : (DIRECCIONES[fila.direction] ?? fila.direction),
    categoria: clave === null ? "sin categoría" : nombreCategoria(clave),
    sinCategoria: clave === null,
    monto: formatoPlata(fila.amount),
    moneda: fila.currency,
    montoClase: reverso ? "rev" : fila.direction === "in" ? "in" : "",
    atenuada: reverso || interna,
    marcada: sinConfirmar,
    sinConfirmar,
    marcas,
  };
}

/**
 * Si queda algo más que traer.
 *
 * Con categoría el motor manda `total` —el número que contó la barra— y la
 * respuesta es exacta. Sin categoría **no hay total y no se pide** (H20): la
 * señal es que la última página vino llena. Puede sobrar un pedido que vuelve
 * vacío, y ese costo es el precio de no hacer un `COUNT` en cada tecleo de
 * filtro. Cuando el número importe, será un `COUNT`.
 */
export function hayMas(traidas: number, limite: number, total?: number): boolean {
  if (typeof total === "number") return traidas < total;
  return traidas > 0 && traidas % limite === 0;
}

/**
 * Por qué una fila **no** se puede responder con *¿Qué es esto?*, o `null` si
 * se puede.
 *
 * Es una sola razón y no una lista de validaciones: el escritor
 * (`classify/apply.ts`) deriva el patrón de la contraparte REAL del ledger, así
 * que sin contraparte no hay nombre sobre el que escribir una regla. Recuperarla
 * es trabajo por lote y no por fila (**H25**), y por eso acá no hay un botón
 * *Recuperar contraparte*: se dice qué falta y se para.
 */
export function motivoSinPregunta(fila: TransactionRow): string | null {
  if (fila.counterparty === null || fila.counterparty.trim() === "") {
    return "Este movimiento no tiene contraparte, así que no hay nombre sobre el que escribir una regla. Recuperarla es un trabajo por lote sobre el correo original, no una corrección de esta fila.";
  }
  return null;
}
