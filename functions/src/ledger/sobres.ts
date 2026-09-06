/**
 * Sobres: cuánta plata hay apartada, y en qué.
 *
 * ## El sobre de emergencia ES el colchón
 *
 * Lo primero que hay que saber para no duplicar plata. El colchón ya era un
 * sobre antes de que existiera esta palabra: vive en `savings/colchon`
 * (`reservedCents`) y su objetivo en `config/strategy.colchonObjetivo`. Este
 * módulo **no crea un sobre nuevo al lado**: lo presenta como el sobre
 * `colchon`, con nombre visible *Emergencia*, y las escrituras sobre él van a
 * los mismos dos lugares de siempre.
 *
 * De ahí sale la única asimetría del modelo, y es una asimetría del motor, no
 * de la interfaz: **el colchón es el único sobre que baja el safe-to-spend**.
 * `safeToSpendHoy` resta `colchonStatus(...).reservado` y ninguna otra cosa.
 * Un sobre nuevo es contabilidad —"de mis 1.100, esto es para el viaje"— y no
 * cambia una sola cifra del Resumen. Si algún día tuviera que cambiarla, sería
 * una decisión del motor con su propio test, no un efecto lateral de esta
 * pantalla.
 *
 * ## Nada se infiere
 *
 * Un sobre nace con el monto que el usuario escribe y se mueve con los aportes
 * y retiros que el usuario registra. **No hay un sobre derivado de las
 * transferencias**: una transferencia entre cuentas propias no dice a qué sobre
 * fue —el banco no tiene sobres, los tiene la persona— y adivinarlo sería
 * exactamente el "monto plausible" que la regla 3 del CLAUDE.md prohíbe. El
 * default de todo acá es cero o vacío.
 *
 * ## Por qué este archivo no importa nada
 *
 * Vive dos veces —acá y en `server/src/strategy/sobres.ts`— con un test de
 * paridad que exige que sean **idénticos byte a byte**, igual que el parser
 * copiado. Para que puedan serlo no importa nada: los dos paquetes tienen sus
 * propios helpers de centavos en rutas distintas (`ledger/derive.ts` acá,
 * `strategy/money.ts` allá) y un solo import rompería la copia. Así que este
 * módulo habla en **centavos enteros** y quien lo llama convierte.
 */

/** El id del sobre del colchón. Es el nombre del documento que ya existía. */
export const ID_COLCHON = "colchon";

/**
 * Cómo se llama el colchón en la pantalla.
 *
 * El documento guarda `label: "colchon"`, que es el token con el que el motor
 * lo busca y no un nombre que alguien haya elegido. Mostrarlo tal cual dejaba
 * un sobre en minúscula y sin tilde en una lista donde el resto tiene el nombre
 * que le puso su dueño.
 */
export const NOMBRE_COLCHON = "Emergencia";

/** Los ids que nadie puede pedir: los dos nombres del sobre que ya existe. */
const IDS_RESERVADOS = new Set([ID_COLCHON, "emergencia"]);

export const MAX_NOMBRE = 40;

/**
 * Cuántos sobres se pueden tener. No es una restricción técnica —Firestore no
 * se inmuta con mil documentos— es que la pantalla los dibuja todos y una lista
 * de sobres que hay que scrollear dejó de contestar "cuánto tengo en cada uno"
 * de un vistazo. Veinte es holgado para el uso que tiene esto.
 */
export const MAX_SOBRES = 20;

/** Un sobre tal como está guardado. `savings/{id}` en Firestore, una fila de
 * `savings` en SQLite. */
export interface SobreDoc {
  id: string;
  /** El nombre que le puso su dueño. Ausente en documentos viejos. */
  label?: string | null;
  reservedCents?: number | null;
  /** El objetivo del sobre. El del colchón NO vive acá: ver `armarSobres`. */
  targetCents?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** Un sobre tal como se lee. En centavos: la capa HTTP convierte. */
export interface SobreCents {
  id: string;
  nombre: string;
  montoCents: number;
  /**
   * `null` es **sin fijar**, y no cero. Es la misma regla que el colchón
   * publica como `fijado` (R25): un objetivo en cero se leía como un objetivo
   * cumplido, y la barra salía llena sin que nadie hubiera reservado un peso.
   */
  objetivoCents: number | null;
  /** El colchón. El único sobre que el motor descuenta del safe-to-spend. */
  sistema: boolean;
  creadoEn: string | null;
  actualizadoEn: string | null;
}

/**
 * El nombre, comparable: sin tildes, sin mayúsculas, sin espacios de más. Dos
 * sobres que sólo difieren en eso son el mismo sobre escrito dos veces, y la
 * pregunta "cuánto tengo en cada uno" deja de tener una respuesta.
 */
export function normalizarNombre(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * El id que le toca a un nombre. Legible a propósito —quien mire la consola de
 * Firestore tiene que reconocer el sobre—, y seguro como segmento de path: sin
 * "/", sin puntos sueltos, sin el prefijo reservado del sistema.
 *
 * El id se fija **al crear y no se vuelve a tocar**: renombrar un sobre cambia
 * su nombre visible y nada más. Mover el documento sería borrarlo y crearlo,
 * que es una forma cara de perder la fecha de creación y los aportes por un
 * cambio de redacción. El precio es que un id puede quedar viejo respecto del
 * nombre; el id es opaco y nadie lo lee para saber qué sobre es.
 */
export function idDeSobre(nombre: string): string {
  const base = normalizarNombre(nombre)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base;
}

/** El nombre visible de un documento guardado. */
function nombreDeDoc(doc: SobreDoc): string {
  if (doc.id === ID_COLCHON) return NOMBRE_COLCHON;
  const label = (doc.label ?? "").trim();
  return label === "" ? doc.id : label;
}

/** Un objetivo en cero, ausente o negativo es "sin fijar". Ver `objetivoCents`. */
function objetivoDe(cents: number | null | undefined): number | null {
  return cents !== null && cents !== undefined && cents > 0 ? cents : null;
}

/**
 * La lista de sobres.
 *
 * **El colchón siempre está**, exista o no su documento: un tenant que nunca
 * reservó nada tiene un colchón en cero, no un colchón que falta. Sin esta
 * garantía la lista quedaba vacía en una billetera recién instalada y la
 * pantalla no tenía dónde ofrecer "reservá algo".
 *
 * Su objetivo llega por parámetro y no del documento porque es el que el motor
 * ya usa (`config/strategy.colchonObjetivo`): tener una segunda copia en
 * `savings/colchon.targetCents` sería un objetivo que la pantalla muestra y el
 * safe-to-spend ignora.
 *
 * Orden: el colchón primero —es el que cambia las cifras— y el resto por monto
 * descendente, con el nombre desempatando para que la lista no baile entre dos
 * lecturas.
 */
export function armarSobres(
  docs: readonly SobreDoc[],
  colchonObjetivoCents: number
): SobreCents[] {
  const colchonDoc = docs.find((doc) => doc.id === ID_COLCHON);
  const colchon: SobreCents = {
    id: ID_COLCHON,
    nombre: NOMBRE_COLCHON,
    montoCents: colchonDoc?.reservedCents ?? 0,
    objetivoCents: objetivoDe(colchonObjetivoCents),
    sistema: true,
    creadoEn: colchonDoc?.createdAt ?? null,
    actualizadoEn: colchonDoc?.updatedAt ?? null,
  };

  const resto = docs
    .filter((doc) => doc.id !== ID_COLCHON)
    .map<SobreCents>((doc) => ({
      id: doc.id,
      nombre: nombreDeDoc(doc),
      montoCents: doc.reservedCents ?? 0,
      objetivoCents: objetivoDe(doc.targetCents),
      sistema: false,
      creadoEn: doc.createdAt ?? null,
      actualizadoEn: doc.updatedAt ?? null,
    }))
    .sort((a, b) =>
      b.montoCents - a.montoCents || a.nombre.localeCompare(b.nombre, "es")
    );

  return [colchon, ...resto];
}

/** Cuánto hay apartado en total. Un entero de centavos: nada de flotantes. */
export function totalEnSobresCents(sobres: readonly SobreCents[]): number {
  return sobres.reduce((suma, sobre) => suma + sobre.montoCents, 0);
}

export type ErrorSobre =
  | "nombre_vacio"
  | "nombre_largo"
  | "nombre_sin_letras"
  | "sobre_reservado"
  | "sobre_duplicado"
  | "demasiados_sobres"
  | "monto_negativo"
  | "sobre_no_existe"
  | "sobre_del_sistema"
  | "monto_y_aporte"
  | "sin_cambios";

export interface PlanCrear {
  id: string;
  nombre: string;
  montoCents: number;
  objetivoCents: number | null;
}

export type Resultado<T> = { ok: true; plan: T } | { ok: false; error: ErrorSobre };

/**
 * Qué escribir para crear un sobre, o por qué no se puede.
 *
 * Todos los rechazos son del motor y no de la validación de forma: que el
 * nombre no choque con otro, que no se pidan veintiún sobres y que nadie cree
 * un segundo colchón son afirmaciones sobre el modelo, no sobre el JSON. La
 * capa HTTP valida tipos; esto valida significado.
 */
export function planCrearSobre(
  entrada: { nombre: string; montoCents?: number; objetivoCents?: number | null },
  existentes: readonly SobreCents[]
): Resultado<PlanCrear> {
  const nombre = entrada.nombre.trim().replace(/\s+/g, " ");
  if (nombre === "") return { ok: false, error: "nombre_vacio" };
  if (nombre.length > MAX_NOMBRE) return { ok: false, error: "nombre_largo" };

  const id = idDeSobre(nombre);
  if (id === "") return { ok: false, error: "nombre_sin_letras" };
  if (IDS_RESERVADOS.has(id)) return { ok: false, error: "sobre_reservado" };

  const normalizado = normalizarNombre(nombre);
  const choca = existentes.some(
    (sobre) => sobre.id === id || normalizarNombre(sobre.nombre) === normalizado
  );
  if (choca) return { ok: false, error: "sobre_duplicado" };

  // El colchón no cuenta para el tope: existe siempre y nadie lo pidió.
  if (existentes.filter((sobre) => !sobre.sistema).length >= MAX_SOBRES) {
    return { ok: false, error: "demasiados_sobres" };
  }

  const montoCents = entrada.montoCents ?? 0;
  if (montoCents < 0) return { ok: false, error: "monto_negativo" };

  return {
    ok: true,
    plan: { id, nombre, montoCents, objetivoCents: objetivoDe(entrada.objetivoCents) },
  };
}

export interface PatchSobre {
  nombre?: string;
  /** El monto final. Excluyente con `aporteCents`. */
  montoCents?: number;
  /** Cuánto entra (o sale, en negativo). Excluyente con `montoCents`. */
  aporteCents?: number;
  /** El objetivo. `null` explícito lo borra: "ya no mido este sobre". */
  objetivoCents?: number | null;
}

export interface PlanAjustar {
  id: string;
  sistema: boolean;
  /** Ausente si el patch no lo tocaba. */
  nombre?: string;
  montoCents?: number;
  objetivoCents?: number | null;
}

/**
 * Qué escribir para ajustar un sobre.
 *
 * `aporte` existe además de `monto` porque las dos preguntas son distintas y
 * las dos se hacen: *"quedaron 900"* (una lectura del banco) y *"metí 200"* (un
 * movimiento). Obligar a la segunda a expresarse como la primera hace que la
 * pantalla tenga que sumar plata, y la plata no se suma en la pantalla.
 * Mandar las dos a la vez es una contradicción, no una preferencia: se rechaza.
 *
 * Un retiro que deja el sobre en negativo también se rechaza. Un sobre con
 * menos que cero adentro no es un estado del mundo — es un error de tipeo.
 */
export function planAjustarSobre(actual: SobreCents, patch: PatchSobre): Resultado<PlanAjustar> {
  const tocaNombre = patch.nombre !== undefined;
  const tocaMonto = patch.montoCents !== undefined;
  const tocaAporte = patch.aporteCents !== undefined;
  const tocaObjetivo = patch.objetivoCents !== undefined;

  if (!tocaNombre && !tocaMonto && !tocaAporte && !tocaObjetivo) {
    return { ok: false, error: "sin_cambios" };
  }
  if (tocaMonto && tocaAporte) return { ok: false, error: "monto_y_aporte" };

  const plan: PlanAjustar = { id: actual.id, sistema: actual.sistema };

  if (tocaNombre) {
    // El colchón no se renombra: su nombre es del motor, igual que su id. Un
    // colchón llamado "vacaciones" seguiría bajando el safe-to-spend, y eso
    // ya no lo entiende nadie.
    if (actual.sistema) return { ok: false, error: "sobre_del_sistema" };
    const nombre = (patch.nombre ?? "").trim().replace(/\s+/g, " ");
    if (nombre === "") return { ok: false, error: "nombre_vacio" };
    if (nombre.length > MAX_NOMBRE) return { ok: false, error: "nombre_largo" };
    if (idDeSobre(nombre) === "") return { ok: false, error: "nombre_sin_letras" };
    plan.nombre = nombre;
  }

  if (tocaMonto || tocaAporte) {
    const montoCents = tocaMonto
      ? (patch.montoCents as number)
      : actual.montoCents + (patch.aporteCents as number);
    if (montoCents < 0) return { ok: false, error: "monto_negativo" };
    plan.montoCents = montoCents;
  }

  if (tocaObjetivo) {
    const objetivo = patch.objetivoCents;
    if (objetivo !== null && objetivo !== undefined && objetivo < 0) {
      return { ok: false, error: "monto_negativo" };
    }
    // Cero y `null` son lo mismo acá —"sin fijar"— y así se guarda: el motor
    // del colchón ya lee un cero como objetivo sin fijar (R25).
    plan.objetivoCents = objetivoDe(objetivo);
  }

  return { ok: true, plan };
}

/**
 * Que un nombre nuevo no choque con otro sobre. Aparte de `planAjustarSobre`
 * porque necesita la lista entera y el plan sólo necesita el sobre que cambia:
 * quien tiene la lista es el llamador, y así el plan se puede probar solo.
 */
export function nombreChoca(
  nombre: string,
  id: string,
  existentes: readonly SobreCents[]
): boolean {
  const normalizado = normalizarNombre(nombre);
  return existentes.some(
    (sobre) => sobre.id !== id && normalizarNombre(sobre.nombre) === normalizado
  );
}
