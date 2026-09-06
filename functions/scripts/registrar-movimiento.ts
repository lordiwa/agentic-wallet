/**
 * Registra en el ledger un movimiento que **una persona dictó**, no que un
 * correo trajo.
 *
 * ## Por qué esto existe
 *
 * Todo lo que hay en `transactions` entró por `ingest/pipeline.ts`: un correo
 * del banco, parseado por el parser determinista. Eso cubre lo que el banco
 * notifica y nada más. Un préstamo en efectivo a un conocido, o una compra que
 * el banco no avisó, no tienen correo — y sin una puerta como ésta el ledger no
 * puede saber que ocurrieron. No hay ninguna ruta HTTP que escriba una
 * transacción (ver `RUTAS` en `src/api/router.ts`: las veinte que existen leen
 * el ledger, mueven etiquetas o resuelven la cola de monto, ninguna crea una
 * fila), así que la puerta se abre acá, en un script con la misma disciplina que
 * `sembrar-sobres.ts` y `reanclar-saldo.ts`: dato explícito, `merge` nunca a
 * ciegas, relectura, y `--yes-produccion` para escribir fuera del emulador.
 *
 * ## Qué NO afloja de la invariante
 *
 * La regla 1 del CLAUDE.md dice que el monto sale del parser determinista y
 * nunca de Claude. Este script no la contradice: el monto sale de **la persona**,
 * que es la otra fuente que el motor ya reconoce — es exactamente el mismo caso
 * que `resolveReview` con `action: "correct"`, y por eso la fila queda con
 * `source: "human"` y no con `deterministic`. Lo que sigue prohibido, acá igual
 * que allá, es que el monto lo ponga un modelo: el script exige `--monto` y no
 * tiene ninguna rama que lo estime, lo redondee ni lo complete.
 *
 * La regla 4 tampoco se toca, pero se aplica al revés: en la ingesta, un monto
 * que no se pudo leer es `null` + `needs_review`. Acá un monto que no se dictó
 * no es un movimiento a medias, es un movimiento que no existe, y el script
 * falla en vez de escribir un cero. `--monto 0` sí se acepta: cero es un monto.
 *
 * ## La contraparte es obligatoria, y puede ser genérica
 *
 * Sin contraparte, `pattern` queda en `null`, `queueEligible` en `false`, y el
 * movimiento **no puede aparecer nunca en la cola de clasificación**: quedaría
 * en "otros" para siempre, sin forma de preguntar qué fue. Por eso se exige, y
 * por eso el valor correcto cuando la persona no dijo a quién es un marcador
 * genérico —lo que dictó, sin adornar— y no un nombre inventado (CLAUDE.md
 * regla 3). Un movimiento de salida con contraparte y sin categoría conocida cae
 * solo en la cola; ahí es donde el humano contesta quién fue.
 *
 * `--categoria` es opcional y sólo se pasa cuando **la persona dijo la
 * categoría**. No la escribe este script: la escribe `classifyCounterparty`, el
 * mismo escritor que usa `POST /api/classify`, para que la regla salga de la
 * contraparte real del ledger y el alcance de la regla se reporte (una regla
 * matchea por subcadena y puede mover más filas que la recién creada).
 *
 * ## El instante
 *
 * Se dicta un DÍA (`--fecha`, local del tenant), no un instante: nadie dicta la
 * hora. El `ts` se fija al **mediodía local** —`12:00` menos el offset del
 * tenant— para que el día local del movimiento sea el dictado bajo cualquier
 * huso, sin que un redondeo lo empuje al día anterior o al siguiente. Ver
 * `localDayKey` en `src/ledger/derive.ts`.
 *
 * ## El id
 *
 * Se deriva del contenido dictado, así que volver a correr la misma dictada no
 * duplica la fila: el script la reconoce como ya registrada y **no la
 * sobreescribe** (igual que la ingesta cuenta un duplicado en vez de pisar).
 * Dos movimientos genuinamente idénticos el mismo día son un caso real y raro:
 * para ése está `--id`.
 *
 * Uso:
 *   node --import ./scripts/ts-resolver.mjs scripts/registrar-movimiento.ts \
 *     --uid <uid> --fecha 2026-09-04 --monto 40 --direccion out \
 *     --tipo debito --contraparte "MEDICINA" [--categoria salud] \
 *     [--nota "..."] [--moneda USD] [--id <id>] [--dry-run] [--yes-produccion]
 */
import { createHash } from "node:crypto";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { CATEGORIES, toRulePattern, type Category } from "../src/ledger/categorize.js";
import {
  toTransactionDoc,
  toCents,
  type RawTransaction,
  type TransactionDoc,
} from "../src/ledger/derive.js";
import { FirestoreLedger } from "../src/ledger/firestore-ledger.js";
import * as paths from "../src/ledger/paths.js";
import { classifyCounterparty, type ClassifySuccess } from "../src/ledger/writes.js";
import type { TransactionType } from "../src/parser/types.js";

/** `YYYY-MM-DD`, la misma forma que exigen los otros scripts. */
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Las direcciones que el ledger conoce. */
export const DIRECCIONES = ["in", "out"] as const;
export type Direccion = (typeof DIRECCIONES)[number];

/**
 * Los tipos que el ledger conoce. No es una lista de adorno: `categorize()`
 * conmuta sobre `type`, así que un tipo escrito de más —"consumo", que suena
 * bien y no existe— cae en el `default` y se comporta distinto del que se
 * quiso, sin error.
 *
 * El `Record<TransactionType, true>` es lo que impide que esta lista se atrase:
 * si el parser gana o pierde un tipo, esto no compila.
 */
const TIPOS_CONOCIDOS: Record<TransactionType, true> = {
  debito: true,
  credito: true,
  transferencia: true,
  recibido: true,
  retiro: true,
  servicio: true,
  recarga: true,
  sueldo: true,
};

export const TIPOS = Object.keys(TIPOS_CONOCIDOS) as readonly TransactionType[];

/** Lo que una persona dicta. Nada acá se infiere: todo lo dijo alguien. */
export interface MovimientoDictado {
  /** Día local del tenant, `YYYY-MM-DD`. */
  fecha: string;
  /** El monto dictado. **Cero es válido**; ausente es un error, no un cero. */
  monto: number;
  direccion: Direccion;
  tipo: string;
  /** Obligatoria. Genérica si la persona no dijo quién — ver el doc del módulo. */
  contraparte: string;
  moneda: string;
  /** Sólo si la persona la dijo. La escribe `classifyCounterparty`, no esto. */
  categoria?: Category;
  /** El texto de la dictada, para poder auditar de dónde salió la fila. */
  nota?: string;
  /** Un id explícito, para el caso raro de dos movimientos idénticos el mismo día. */
  id?: string;
}

export type ErrorDictado =
  | "fecha_invalida"
  | "monto_invalido"
  | "direccion_invalida"
  | "tipo_invalido"
  | "contraparte_vacia"
  | "moneda_invalida"
  | "categoria_invalida";

export type PlanRegistro =
  | { ok: true; id: string; fila: RawTransaction }
  | { ok: false; error: ErrorDictado };

/** El instante UTC del mediodía local del día dictado. Ver el doc del módulo. */
export function instanteDelDia(fecha: string, offsetHours: number): string {
  return new Date(Date.parse(`${fecha}T12:00:00Z`) - offsetHours * 3_600_000).toISOString();
}

/**
 * El id del documento, derivado del contenido dictado.
 *
 * Lleva prefijo `manual-` para que sea obvio en la consola de Firestore que esa
 * fila no vino de un correo, y un hash corto del resto para que dos dictadas
 * distintas del mismo día no colisionen. El hash **no es** un secreto ni una
 * firma: es sólo una clave estable.
 */
export function idDeMovimiento(mov: MovimientoDictado): string {
  const huella = [
    mov.fecha,
    mov.direccion,
    mov.tipo,
    toCents(mov.monto),
    mov.moneda,
    toRulePattern(mov.contraparte),
  ].join("|");
  return `manual-${mov.fecha}-${createHash("sha256").update(huella).digest("hex").slice(0, 12)}`;
}

/**
 * Valida la dictada y arma la fila cruda. Pura: es lo que el test ejercita sin
 * tocar ninguna base.
 */
export function planRegistro(
  mov: MovimientoDictado,
  offsetHours: number,
  ahora: Date = new Date()
): PlanRegistro {
  if (!DIA.test(mov.fecha) || Number.isNaN(Date.parse(`${mov.fecha}T12:00:00Z`))) {
    return { ok: false, error: "fecha_invalida" };
  }
  // Cero pasa; NaN, infinito y negativo no. Un monto negativo sería una
  // dirección disfrazada, y la dirección ya viaja en su propio campo.
  if (typeof mov.monto !== "number" || !Number.isFinite(mov.monto) || mov.monto < 0) {
    return { ok: false, error: "monto_invalido" };
  }
  if (!(DIRECCIONES as readonly string[]).includes(mov.direccion)) {
    return { ok: false, error: "direccion_invalida" };
  }
  if (!(TIPOS as readonly string[]).includes(mov.tipo)) return { ok: false, error: "tipo_invalido" };
  // El patrón, no el texto: una contraparte de puros espacios normaliza a vacío
  // y dejaría la fila fuera de la cola para siempre.
  if (toRulePattern(mov.contraparte) === "") return { ok: false, error: "contraparte_vacia" };
  if (mov.moneda.trim() === "") return { ok: false, error: "moneda_invalida" };
  if (mov.categoria !== undefined && !(CATEGORIES as readonly string[]).includes(mov.categoria)) {
    return { ok: false, error: "categoria_invalida" };
  }

  const contraparte = mov.contraparte.trim();
  const fila: RawTransaction = {
    gmail_msg_id: mov.id ?? idDeMovimiento(mov),
    // No hubo correo. Decirlo con `null` es más honesto que fabricar un hilo.
    gmail_thread_id: null,
    ts: instanteDelDia(mov.fecha, offsetHours),
    direction: mov.direccion,
    type: mov.tipo,
    amount: mov.monto,
    currency: mov.moneda.trim(),
    counterparty: contraparte,
    account: null,
    account_holder: null,
    // La columna histórica se deja en `null` igual que en la ingesta: la
    // categoría que se muestra la recalcula el motor, y si la persona dictó una
    // la escribe `classifyCounterparty` junto con su regla.
    category: null,
    raw_subject: mov.nota ?? null,
    is_reversed: 0,
    is_internal: 0,
    // La persona afirmó el monto: no hay nada que revisar. La cola de monto es
    // para lo que el parser no pudo leer.
    needs_review: 0,
    is_discarded: 0,
    // El mismo valor que `resolveReview` deja tras un `correct`. Ver el módulo.
    source: "human",
    created_at: ahora.toISOString(),
  };

  return { ok: true, id: fila.gmail_msg_id, fila };
}

export interface ReporteRegistro {
  uid: string;
  id: string;
  /** El documento ya estaba: no se escribió nada. Ver el doc del módulo. */
  yaEstaba: boolean;
  /** Firestore, releído, coincide con lo que se mandó. */
  verificado: boolean;
  /** Los derivados releídos: de acá sale si el movimiento va a contar y si la
   * cola lo va a preguntar. */
  derivados: { countable: boolean; queueEligible: boolean; month: string | null; day: string | null } | null;
  amountCents: number;
  pattern: string | null;
  /** Presente sólo si la persona dictó la categoría. */
  clasificacion: ClassifySuccess | { ok: false; error: string } | null;
  dryRun: boolean;
}

/**
 * Escribe el movimiento y RELEE para verificar.
 *
 * La relectura no es ceremonia (misma razón que en `sembrar-sobres.ts`): lo que
 * hay que poder afirmar no es "mandé una escritura" sino "el ledger, leído de
 * nuevo, tiene esta fila con este monto y con estos derivados". Los derivados
 * importan tanto como el monto: `countable` decide si suma en el Resumen y
 * `queueEligible` decide si la cola puede preguntar por ella.
 */
export async function registrarMovimiento(options: {
  firestore: Firestore;
  uid: string;
  movimiento: MovimientoDictado;
  dryRun?: boolean;
  now?: Date;
}): Promise<ReporteRegistro> {
  const { firestore, uid, movimiento } = options;
  const dryRun = options.dryRun ?? false;
  const ahora = options.now ?? new Date();
  paths.assertUid(uid);

  const ledger = new FirestoreLedger(firestore, uid);
  const config = await ledger.strategyConfig();
  const offsetHours = config.utcOffsetHours;
  // La moneda del tenant es el default: un monto dictado está en la moneda en
  // la que la persona vive, y los totales del motor suman sin mirar `currency`.
  const mov = { ...movimiento, moneda: movimiento.moneda || config.moneda };

  const plan = planRegistro(mov, offsetHours, ahora);
  if (!plan.ok) throw new Error(`dictada invalida: ${plan.error}`);

  const doc = toTransactionDoc(plan.fila, offsetHours);
  const ref = paths.transactions(firestore, uid).doc(plan.id);

  const base: ReporteRegistro = {
    uid,
    id: plan.id,
    yaEstaba: false,
    verificado: false,
    derivados: null,
    amountCents: doc.amountCents,
    pattern: doc.pattern,
    clasificacion: null,
    dryRun,
  };

  // Leer antes de escribir, igual que la ingesta: un `set` a secas también
  // sería idempotente, pero no podría decir si esta corrida registró algo.
  const previo = await ref.get();
  if (previo.exists) return { ...base, yaEstaba: true, verificado: false };
  if (dryRun) return base;

  await ref.set(doc as unknown as Record<string, unknown>);

  const releido = (await ref.get()).data() as TransactionDoc | undefined;
  const verificado =
    releido !== undefined &&
    releido.amountCents === doc.amountCents &&
    releido.direction === doc.direction &&
    releido.type === doc.type &&
    releido.counterparty === doc.counterparty &&
    releido.currency === doc.currency &&
    releido.ts === doc.ts &&
    releido.countable === doc.countable &&
    releido.queueEligible === doc.queueEligible;

  const reporte: ReporteRegistro = {
    ...base,
    verificado,
    derivados:
      releido === undefined
        ? null
        : {
            countable: releido.countable,
            queueEligible: releido.queueEligible,
            month: releido.month,
            day: releido.day,
          },
  };

  if (mov.categoria === undefined) return reporte;

  // La categoría la escribe el escritor del motor, no este script: así el
  // patrón sale de la contraparte real y el alcance de la regla se reporta.
  const resultado = await classifyCounterparty(
    ledger,
    { counterparty: plan.fila.counterparty as string, category: mov.categoria },
    ahora,
    offsetHours
  );
  return { ...reporte, clasificacion: resultado };
}

// --- CLI -------------------------------------------------------------------

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function texto(valor: string | boolean | undefined): string | undefined {
  return typeof valor === "string" ? valor : undefined;
}

const USO =
  "uso: registrar-movimiento.ts --uid <uid> --fecha YYYY-MM-DD --monto <n> " +
  "--direccion in|out --tipo <tipo> --contraparte <texto> " +
  "[--categoria <cat>] [--nota <texto>] [--moneda <cod>] [--id <id>] " +
  "[--dry-run] [--yes-produccion]";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const uid = texto(args.uid);
  const fecha = texto(args.fecha);
  const montoRaw = texto(args.monto);
  const direccion = texto(args.direccion);
  const tipo = texto(args.tipo);
  const contraparte = texto(args.contraparte);

  if (
    uid === undefined ||
    fecha === undefined ||
    montoRaw === undefined ||
    direccion === undefined ||
    tipo === undefined ||
    contraparte === undefined
  ) {
    console.error(USO);
    process.exit(2);
  }

  // `Number("")` es 0: un `--monto` vacío no puede pasar por cero.
  const monto = montoRaw.trim() === "" ? Number.NaN : Number(montoRaw);

  const contraEmulador = process.env.FIRESTORE_EMULATOR_HOST !== undefined;
  if (!contraEmulador && args["yes-produccion"] !== true) {
    console.error(
      "negado: FIRESTORE_EMULATOR_HOST no esta puesto, o sea que esto escribiria en PRODUCCION.\n" +
        "Si es lo que queres, pasa --yes-produccion explicitamente."
    );
    process.exit(3);
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? "agentic-wallet-71314";
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const app = initializeApp(
    contraEmulador || credentialPath === undefined
      ? { projectId }
      : { projectId, credential: cert(credentialPath) }
  );

  const reporte = await registrarMovimiento({
    firestore: getFirestore(app),
    uid,
    movimiento: {
      fecha,
      monto,
      direccion: direccion as Direccion,
      tipo,
      contraparte,
      moneda: texto(args.moneda) ?? "",
      categoria: texto(args.categoria) as Category | undefined,
      nota: texto(args.nota),
      id: texto(args.id),
    },
    dryRun: args["dry-run"] === true,
  });

  console.log(JSON.stringify(reporte, null, 2));
  process.exit(reporte.dryRun || reporte.yaEstaba || reporte.verificado ? 0 : 1);
}

const invocadoDirecto =
  process.argv[1] !== undefined && process.argv[1].endsWith("registrar-movimiento.ts");
if (invocadoDirecto) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
