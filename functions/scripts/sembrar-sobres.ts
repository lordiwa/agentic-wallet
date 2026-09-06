/**
 * Siembra los sobres de un tenant en Firestore desde un SQLite real.
 *
 * ## Por qué esto es un script y no una migración
 *
 * `migrate-tenant.ts` porta la colección `savings` tal como está en la base de
 * origen, y en la base de origen `savings` tenía **una sola fila**: el colchón,
 * en cero. Los montos que el usuario sí tenía apartados no viven ahí — viven
 * en la tabla `saldos`, que es "re-anclas leídas del banco por el usuario, no
 * derivadas" (`server/src/db/schema.ts`), la misma tabla y la misma fila de la
 * que `reanclar-saldo.ts` saca el `balanceSnapshot`.
 *
 * Esa fila tiene tres columnas de plata, una por cuenta, y cada una es un
 * sobre:
 *
 * | columna       | sobre        | dónde va                                  |
 * |---------------|--------------|-------------------------------------------|
 * | `corriente`   | `corriente`  | `savings/corriente.reservedCents`         |
 * | `flexiahorro` | `flexiahorro`| `savings/flexiahorro.reservedCents`       |
 * | `emergencia`  | `colchon`    | `savings/colchon.reservedCents`            |
 *
 * La tercera fila de esa tabla es la que hay que mirar dos veces: **el sobre de
 * emergencia ES el colchón**, no uno nuevo al lado. El porqué está en el doc de
 * `ledger/sobres.ts`; acá lo que importa es la consecuencia operativa. Como el
 * colchón es el único sobre que `safeToSpendHoy` descuenta, sembrar la columna
 * `emergencia` **baja el safe-to-spend en ese monto**. Es el efecto buscado —lo
 * apartado deja de estar disponible— y no un daño colateral, pero es la única
 * cifra del Resumen que este script mueve, así que se dice acá y se reporta.
 *
 * ## Qué no toca
 *
 * - **El objetivo de ningún sobre.** `saldos` dice cuánto hay, no cuánto se
 *   quería: un `targetCents` derivado del monto sería un objetivo ya cumplido
 *   que nadie fijó. El del colchón además vive en
 *   `config/strategy.colchonObjetivo` y es el que el motor lee.
 * - **El nombre de un sobre que ya existe.** Si el usuario lo renombró, el
 *   nombre es suyo. Sólo se escribe `label` al crear.
 * - **Cualquier otro campo del documento.** Se escribe con `merge`, nunca con
 *   un `set` entero (`legacyId`, `createdAt` y demás siguen donde están).
 *
 * ## No inventa (CLAUDE.md regla 3 y 4)
 *
 * Una columna en `NULL` es "no sé cuánto hay" y se **saltea**: no se siembra un
 * cero, porque un cero es la afirmación "el banco decía cero". Un `0` explícito
 * en la columna, en cambio, sí se siembra — es una lectura. Y si no hay
 * ninguna fila de `saldos` con al menos una columna real, el script falla en
 * vez de escribir nada.
 *
 * Uso:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     node --import ./scripts/ts-resolver.mjs scripts/sembrar-sobres.ts \
 *     --sqlite /ruta/a/la/base.sqlite --uid <uid> [--dry-run]
 *
 * Igual que la migración y la re-ancla, escribir en producción exige
 * `--yes-produccion`.
 */
import Database from "better-sqlite3";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import * as paths from "../src/ledger/paths.js";
import { toCents } from "../src/ledger/derive.js";
import { ID_COLCHON } from "../src/ledger/sobres.js";

/** `YYYY-MM-DD`, la misma forma que exige `reanclar-saldo.ts`. */
const DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Qué columna de `saldos` es qué sobre.
 *
 * `emergencia` apunta a `colchon` a propósito: es el id del documento que ya
 * existía. El `nombre` sólo se usa al crear, y el del colchón nunca se usa
 * porque su documento existe desde el seed —y si no existiera, `armarSobres`
 * lo muestra igual como *Emergencia*.
 */
const COLUMNAS = [
  { columna: "corriente", id: "corriente", nombre: "Corriente" },
  { columna: "flexiahorro", id: "flexiahorro", nombre: "FlexiAhorro" },
  { columna: "emergencia", id: ID_COLCHON, nombre: "Emergencia" },
] as const;

export interface SobreSembrable {
  id: string;
  /** Sólo se escribe si el documento no existe. */
  nombre: string;
  montoCents: number;
  /** El colchón. El único que mueve el safe-to-spend. */
  sistema: boolean;
}

export interface LecturaSaldos {
  /** La fecha de la fila. No es un dato sensible: fecha sí, monto no. */
  fecha: string;
  sobres: SobreSembrable[];
}

function tablaExiste(db: Database.Database, tabla: string): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabla) !==
    undefined
  );
}

/**
 * Los sobres de la fila más reciente de `saldos`.
 *
 * Se pide la fila más nueva que tenga **al menos una** columna de plata: una
 * fila donde las tres son `NULL` no dice nada y no debería tapar a una anterior
 * que sí decía algo. Dentro de la fila elegida, cada columna se evalúa sola.
 */
export function leerSobresDeSaldos(db: Database.Database): LecturaSaldos | null {
  if (!tablaExiste(db, "saldos")) return null;

  const row = db
    .prepare(
      "SELECT fecha, corriente, flexiahorro, emergencia FROM saldos " +
        "WHERE corriente IS NOT NULL OR flexiahorro IS NOT NULL OR emergencia IS NOT NULL " +
        "ORDER BY fecha DESC LIMIT 1"
    )
    .get() as Record<string, unknown> | undefined;
  if (row === undefined) return null;

  const fecha = row.fecha;
  if (typeof fecha !== "string" || !DIA.test(fecha)) return null;

  const sobres: SobreSembrable[] = [];
  for (const { columna, id, nombre } of COLUMNAS) {
    const valor = row[columna];
    // `null` es "no sé" y se saltea; `0` es una lectura y se siembra.
    if (typeof valor !== "number" || !Number.isFinite(valor)) continue;
    if (valor < 0) continue; // un sobre en negativo no es un sobre
    sobres.push({ id, nombre, montoCents: toCents(valor), sistema: id === ID_COLCHON });
  }

  return sobres.length === 0 ? null : { fecha, sobres };
}

export interface ReporteSobre {
  id: string;
  /** El documento ya estaba: se actualizó el monto y nada más. */
  existia: boolean;
  /** El colchón, el único que baja el safe-to-spend. */
  sistema: boolean;
  /** Firestore, releído, coincide con lo que se mandó. */
  verificado: boolean;
}

export interface ReporteSembrado {
  uid: string;
  /** La fecha de la fila de `saldos` que se usó. */
  fecha: string;
  sobres: ReporteSobre[];
  /** El safe-to-spend baja por el colchón. `true` si el colchón cambió. */
  colchonMovido: boolean;
  dryRun: boolean;
}

/**
 * Escribe los sobres y RELEE para verificar.
 *
 * La relectura no es ceremonia: un reporte de lo que se creyó escribir no
 * sirve para decidir nada, que es la misma razón por la que la migración
 * vuelve a contar y la re-ancla vuelve a leer el perfil.
 */
export async function sembrarSobres(options: {
  firestore: Firestore;
  sqlitePath: string;
  uid: string;
  dryRun?: boolean;
}): Promise<ReporteSembrado> {
  const { firestore, sqlitePath, uid } = options;
  const dryRun = options.dryRun ?? false;
  paths.assertUid(uid);

  const sqlite = new Database(sqlitePath, { readonly: true });
  let lectura: LecturaSaldos | null;
  try {
    lectura = leerSobresDeSaldos(sqlite);
  } finally {
    sqlite.close();
  }

  if (lectura === null) {
    throw new Error(
      "el SQLite no tiene ninguna fila de `saldos` con un monto real. " +
        "No se escribe nada: sembrar ceros inventados seria peor que dejar los sobres vacios."
    );
  }

  const col = paths.savings(firestore, uid);
  const ahora = new Date().toISOString();
  const reportes: ReporteSobre[] = [];
  let colchonMovido = false;

  for (const sobre of lectura.sobres) {
    const ref = col.doc(sobre.id);
    const snap = await ref.get();
    const existia = snap.exists;
    const previo = existia ? (snap.data() as { reservedCents?: unknown }) : undefined;
    const cambia = previo?.reservedCents !== sobre.montoCents;
    if (sobre.sistema && cambia) colchonMovido = true;

    if (dryRun) {
      reportes.push({ id: sobre.id, existia, sistema: sobre.sistema, verificado: false });
      continue;
    }

    // El `label` va sólo al crear: un sobre que el usuario renombró conserva su
    // nombre. `targetCents` no se toca nunca — ver el encabezado.
    const patch: Record<string, unknown> = {
      reservedCents: sobre.montoCents,
      updatedAt: ahora,
    };
    if (!existia) {
      patch.label = sobre.nombre;
      patch.createdAt = ahora;
    }
    await ref.set(patch, { merge: true });

    const releido = (await ref.get()).data() as { reservedCents?: unknown } | undefined;
    reportes.push({
      id: sobre.id,
      existia,
      sistema: sobre.sistema,
      verificado: releido?.reservedCents === sobre.montoCents,
    });
  }

  return { uid, fecha: lectura.fecha, sobres: reportes, colchonMovido, dryRun };
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sqlitePath = typeof args.sqlite === "string" ? args.sqlite : null;
  const uid = typeof args.uid === "string" ? args.uid : null;
  if (sqlitePath === null || uid === null) {
    console.error("uso: sembrar-sobres.ts --sqlite <ruta> --uid <uid> [--dry-run] [--yes-produccion]");
    process.exit(2);
  }

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

  const reporte = await sembrarSobres({
    firestore: getFirestore(app),
    sqlitePath,
    uid,
    dryRun: args["dry-run"] === true,
  });

  // Ids, fecha y booleanos. Los montos NO se imprimen: CLAUDE.md regla 2.
  console.log(JSON.stringify(reporte, null, 2));
  const ok = reporte.dryRun || reporte.sobres.every((sobre) => sobre.verificado);
  process.exit(ok ? 0 : 1);
}

const invocadoDirecto = process.argv[1] !== undefined && process.argv[1].endsWith("sembrar-sobres.ts");
if (invocadoDirecto) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
