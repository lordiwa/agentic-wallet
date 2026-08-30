// Drena el buzon REAL por lotes chicos contra una base TEMPORAL, en procesos
// separados: si el checkpoint no sobreviviera a la muerte del proceso, el
// segundo lote volveria a empezar de cero. Nunca toca la base del usuario.
import { loadConfig } from "./src/config.js";
import { openDb } from "./src/db/open.js";
import { buildProductionSyncRunner } from "./src/sync/build-sync-runner.js";

const dbPath = process.env.PROBE_DB!;
const batchSize = Number(process.env.PROBE_BATCH ?? "5");
const config = { ...loadConfig(), WALLET_DB_PATH: dbPath };
const db = openDb(dbPath);
const runner = buildProductionSyncRunner(config, () => db);
if (!runner) throw new Error("runner null: credenciales no utilizables");

const started = Date.now();
const r = await runner({ batchSize });
console.log(JSON.stringify({
  ms: Date.now() - started,
  progress: r.progress,
  seen: r.seen, inserted: r.inserted, duplicates: r.duplicates,
  needsReview: r.needsReview, skipped: r.skipped,
}));
