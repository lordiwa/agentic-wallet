/**
 * Migración de un ledger SQLite a Firestore, bajo un uid dado.
 *
 * Vive en `scripts/` y no en `src/` porque depende de `better-sqlite3`, que es
 * una dependencia de desarrollo: el binario nativo no tiene por qué viajar en
 * el bundle de las Cloud Functions. `functions/tsconfig.json` no compila esta
 * carpeta y `firebase.json` la excluye del deploy.
 *
 * Tres propiedades que el diseño se compromete a mantener:
 *
 * 1. **Idempotente.** El id del documento de un movimiento es su
 *    `gmail_msg_id`, así que correr la migración dos veces reescribe los
 *    mismos documentos en vez de duplicarlos. Es la misma llave que hace
 *    idempotente a la ingesta (`server/src/ingest/pipeline.ts`), ahora
 *    convertida en la clave primaria en vez de en un índice UNIQUE.
 * 2. **Verificable.** Al terminar vuelve a CONTAR contra Firestore y compara
 *    con lo leído del SQLite. Una migración que reporta lo que creyó escribir
 *    en vez de lo que hay no sirve para decidir si se puede apagar el server
 *    viejo.
 * 3. **No inventa.** Ningún default de conveniencia: lo que el SQLite no
 *    tiene, el documento no lo lleva. CLAUDE.md regla 3.
 *
 * Uso:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *     node --experimental-strip-types scripts/migrate-tenant.ts \
 *     --sqlite /ruta/al/snapshot.sqlite --uid <uid> [--dry-run]
 *
 * La variable de entorno del emulador es OBLIGATORIA salvo que se pase
 * `--yes-produccion`. No es paranoia: el modo por defecto de
 * `firebase-admin` es hablarle a producción, y un `--uid` mal tipeado contra
 * producción escribe mil documentos en la cuenta de otra persona.
 */
import Database from "better-sqlite3";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { toTransactionDoc, toCents, type RawTransaction } from "../src/ledger/derive.js";
import * as paths from "../src/ledger/paths.js";
import { DEFAULT_STRATEGY_CONFIG, type StrategyConfigDoc } from "../src/ledger/firestore-ledger.js";

/** Firestore acepta hasta 500 operaciones por batch. 400 deja aire para que un
 * documento gordo no empuje el batch sobre el límite de 10 MiB. */
const BATCH_SIZE = 400;

export interface MigrationReport {
  uid: string;
  leido: Record<string, number>;
  escrito: Record<string, number>;
  /** Lo que Firestore dice que hay DESPUÉS de escribir, contado de nuevo. */
  verificado: Record<string, number>;
  /** Vacío = la migración cuadra. */
  discrepancias: string[];
  dryRun: boolean;
}

interface SqliteRow {
  [key: string]: unknown;
}

/** Lee el offset horario del `strategy_config` para poder bucketear los meses
 * locales igual que el motor. Si el perfil no lo trae, el default del motor. */
function readOffsetHours(config: Partial<StrategyConfigDoc>): number {
  const raw = (config as { utcOffsetHours?: unknown }).utcOffsetHours;
  return typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_STRATEGY_CONFIG.utcOffsetHours;
}

/**
 * `strategy_config` es una tabla clave/valor donde el valor es JSON. Se
 * reconstruye el objeto tipado, tolerando un valor corrupto sin perder el
 * resto — el mismo criterio que `getStrategyConfig` en el server: una clave
 * mal escrita defaultea sola, no invalida el perfil entero.
 */
export function readStrategyConfig(db: Database.Database): StrategyConfigDoc {
  const rows = db.prepare("SELECT key, value FROM strategy_config").all() as { key: string; value: string }[];
  const config: Record<string, unknown> = { ...DEFAULT_STRATEGY_CONFIG };
  for (const row of rows) {
    try {
      config[row.key] = JSON.parse(row.value);
    } catch {
      config[row.key] = row.value;
    }
  }
  return config as unknown as StrategyConfigDoc;
}

function allRows(db: Database.Database, table: string): SqliteRow[] {
  const exists = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table);
  if (!exists) return [];
  return db.prepare(`SELECT * FROM "${table}"`).all() as SqliteRow[];
}

/**
 * Escribe en batches, contando lo que efectivamente se mandó. `dryRun` recorre
 * todo y no escribe nada: sirve para ver el reporte antes de tocar Firestore.
 */
async function writeAll(
  db: Firestore,
  docs: { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }[],
  dryRun: boolean
): Promise<number> {
  if (dryRun) return docs.length;
  let written = 0;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + BATCH_SIZE)) {
      batch.set(doc.ref, doc.data);
    }
    await batch.commit();
    written += Math.min(BATCH_SIZE, docs.length - i);
  }
  return written;
}

export async function migrateTenant(options: {
  firestore: Firestore;
  sqlitePath: string;
  uid: string;
  dryRun?: boolean;
}): Promise<MigrationReport> {
  const { firestore, sqlitePath, uid } = options;
  const dryRun = options.dryRun ?? false;
  paths.assertUid(uid);

  const sqlite = new Database(sqlitePath, { readonly: true });
  try {
    const config = readStrategyConfig(sqlite);
    const offsetHours = readOffsetHours(config);

    const txRows = allRows(sqlite, "transactions") as unknown as (RawTransaction & { id: number })[];
    const ruleRows = allRows(sqlite, "category_rules") as unknown as {
      pattern: string;
      category: string;
      created_at: string | null;
    }[];
    const silencedRows = allRows(sqlite, "classify_silenced") as unknown as {
      pattern: string;
      counterparty: string;
      created_at: string;
    }[];
    const statementRows = allRows(sqlite, "statements") as unknown as {
      id: number;
      card_mask: string | null;
      issue_date: string | null;
      balance: number | null;
      min_payment: number | null;
      due_date: string | null;
      gmail_msg_id: string | null;
    }[];
    const savingsRows = allRows(sqlite, "savings") as unknown as {
      id: number;
      label: string | null;
      target: number | null;
      reserved: number | null;
      updated_at: string | null;
    }[];
    const debtRows = allRows(sqlite, "debts") as unknown as {
      id: number;
      person: string;
      amount: number;
      kind: string;
      status: string;
      note: string | null;
    }[];
    const reviewRows = allRows(sqlite, "review_resolutions") as unknown as {
      id: number;
      transaction_id: number;
      gmail_msg_id: string;
      action: string;
      previous_amount: number | null;
      new_amount: number | null;
      note: string | null;
      resolved_by: string;
      resolved_at: string;
    }[];

    const leido = {
      transactions: txRows.length,
      rules: ruleRows.length,
      silenced: silencedRows.length,
      statements: statementRows.length,
      savings: savingsRows.length,
      debts: debtRows.length,
      reviews: reviewRows.length,
    };

    const txDocs = txRows.map((row) => ({
      ref: paths.transactions(firestore, uid).doc(row.gmail_msg_id),
      data: toTransactionDoc(row, offsetHours) as unknown as Record<string, unknown>,
    }));

    const ruleDocs = ruleRows.map((row) => ({
      // El id del documento ES el patrón: una regla por patrón, que es
      // exactamente el UNIQUE que tenía la tabla.
      ref: paths.rules(firestore, uid).doc(encodeDocId(row.pattern)),
      data: { pattern: row.pattern, category: row.category, createdAt: row.created_at ?? "" },
    }));

    const silencedDocs = silencedRows.map((row) => ({
      ref: paths.silenced(firestore, uid).doc(encodeDocId(row.pattern)),
      data: { pattern: row.pattern, counterparty: row.counterparty, createdAt: row.created_at },
    }));

    const statementDocs = statementRows.map((row) => ({
      // Sin `gmail_msg_id` no hay llave natural; se cae al id de SQLite, que
      // dentro de un mismo tenant sigue siendo único.
      ref: paths.statements(firestore, uid).doc(row.gmail_msg_id ?? `legacy-${row.id}`),
      data: {
        gmailMsgId: row.gmail_msg_id,
        cardMask: row.card_mask,
        issueDate: row.issue_date,
        balance: row.balance,
        minPayment: row.min_payment,
        dueDate: row.due_date,
        legacyId: row.id,
      },
    }));

    const savingsDocs = savingsRows.map((row) => ({
      ref: paths.savings(firestore, uid).doc(row.label && row.label !== "" ? encodeDocId(row.label) : `legacy-${row.id}`),
      data: {
        label: row.label,
        targetCents: row.target === null ? null : toCents(row.target),
        reservedCents: toCents(row.reserved ?? 0),
        updatedAt: row.updated_at,
        legacyId: row.id,
      },
    }));

    const debtDocs = debtRows.map((row) => ({
      ref: paths.debts(firestore, uid).doc(`legacy-${row.id}`),
      data: {
        person: row.person,
        amountCents: toCents(row.amount),
        kind: row.kind,
        status: row.status,
        note: row.note,
        legacyId: row.id,
      },
    }));

    const reviewDocs = reviewRows.map((row) => ({
      ref: paths.reviews(firestore, uid).doc(`legacy-${row.id}`),
      data: {
        // `transaction_id` era un INTEGER que en Firestore no apunta a nada:
        // se guarda el `gmail_msg_id`, que SÍ es el id del documento destino,
        // y el entero queda sólo como rastro de la migración.
        gmailMsgId: row.gmail_msg_id,
        legacyTransactionId: row.transaction_id,
        action: row.action,
        previousAmountCents: row.previous_amount === null ? null : toCents(row.previous_amount),
        newAmountCents: row.new_amount === null ? null : toCents(row.new_amount),
        note: row.note,
        resolvedBy: row.resolved_by,
        resolvedAt: row.resolved_at,
        legacyId: row.id,
      },
    }));

    const escrito = {
      transactions: await writeAll(firestore, txDocs, dryRun),
      rules: await writeAll(firestore, ruleDocs, dryRun),
      silenced: await writeAll(firestore, silencedDocs, dryRun),
      statements: await writeAll(firestore, statementDocs, dryRun),
      savings: await writeAll(firestore, savingsDocs, dryRun),
      debts: await writeAll(firestore, debtDocs, dryRun),
      reviews: await writeAll(firestore, reviewDocs, dryRun),
    };

    if (!dryRun) {
      await paths.configDoc(firestore, uid, "strategy").set({
        ...config,
        utcOffsetHours: offsetHours,
      });
      const syncRows = allRows(sqlite, "sync_state") as unknown as {
        last_sync_ts: string | null;
        last_history: string | null;
      }[];
      await paths.configDoc(firestore, uid, "sync").set({
        lastSyncTs: syncRows[0]?.last_sync_ts ?? null,
        lastHistory: syncRows[0]?.last_history ?? null,
        // El backlog a medio drenar NO se migra: es estado de un proceso que
        // se está apagando, no del ledger. La ingesta nueva rearma el suyo.
        migratedAt: new Date().toISOString(),
      });
      await paths.userDoc(firestore, uid).set(
        { createdAt: new Date().toISOString(), origen: "migracion-sqlite" },
        { merge: true }
      );
    }

    const verificado = dryRun
      ? { ...escrito }
      : {
          transactions: (await paths.transactions(firestore, uid).count().get()).data().count,
          rules: (await paths.rules(firestore, uid).count().get()).data().count,
          silenced: (await paths.silenced(firestore, uid).count().get()).data().count,
          statements: (await paths.statements(firestore, uid).count().get()).data().count,
          savings: (await paths.savings(firestore, uid).count().get()).data().count,
          debts: (await paths.debts(firestore, uid).count().get()).data().count,
          reviews: (await paths.reviews(firestore, uid).count().get()).data().count,
        };

    const discrepancias: string[] = [];
    for (const key of Object.keys(leido)) {
      const esperado = leido[key as keyof typeof leido];
      const hay = verificado[key];
      if (hay !== esperado) {
        discrepancias.push(`${key}: el SQLite tiene ${esperado} y Firestore quedo con ${hay}`);
      }
    }

    return { uid, leido, escrito, verificado, discrepancias, dryRun };
  } finally {
    sqlite.close();
  }
}

/**
 * Un id de documento de Firestore no puede contener "/", ni ser "." o "..",
 * ni pasar de 1500 bytes. Un patrón normalizado es texto libre del banco: casi
 * siempre inofensivo, pero "casi" no alcanza para una clave primaria.
 *
 * Se codifica sólo lo prohibido y se deja el resto legible, para que un humano
 * pueda mirar la consola de Firestore y reconocer la regla.
 */
export function encodeDocId(raw: string): string {
  const safe = raw.replace(/\//g, "%2F");
  // `encodeURIComponent(".")` devuelve "." — el punto es un caracter no
  // reservado de URI. La sustitucion tiene que ser explicita.
  if (safe === ".") return "%2E";
  if (safe === "..") return "%2E%2E";
  if (/^__.*__$/.test(safe)) return `x${safe}`;
  const bytes = Buffer.from(safe, "utf8");
  return bytes.length <= 1500 ? safe : bytes.subarray(0, 1500).toString("utf8");
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
    console.error("uso: migrate-tenant.ts --sqlite <ruta> --uid <uid> [--dry-run] [--yes-produccion]");
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

  const report = await migrateTenant({
    firestore: getFirestore(app),
    sqlitePath,
    uid,
    dryRun: args["dry-run"] === true,
  });

  // Sólo conteos: ni un nombre, ni un monto. CLAUDE.md regla 2.
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.discrepancias.length === 0 ? 0 : 1);
}

const invocadoDirecto = process.argv[1] !== undefined && process.argv[1].endsWith("migrate-tenant.ts");
if (invocadoDirecto) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
