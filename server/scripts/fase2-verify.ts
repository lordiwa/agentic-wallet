/**
 * TEMPORAL — verificacion de fase 2 (re-corrida con el parser ampliado).
 * NO se commitea: se borra al terminar la medicion.
 *
 * Dos subcomandos, ninguno toca datos ni corre el server HTTP:
 *
 *   classify <N>  — arma el backlog con la misma query que el sync, toma los
 *                   N mas nuevos y los pasa SOLO por el parser determinista
 *                   (sin Claude, sin base): mide cobertura real por asunto.
 *   sync <N>      — corre el runner de produccion en lotes hasta procesar N.
 *
 * La salida es JSON/conteos. Nunca imprime cuerpos ni contrapartes completas.
 */
import { loadConfig } from "../src/config.js";
import { openDb } from "../src/db/open.js";
import { buildProductionSyncRunner } from "../src/sync/build-sync-runner.js";
import { buildSearchQuery, createGoogleapisGmailClient, extractReversoFields } from "../src/ingest/index.js";
import { parseEmail } from "../src/parser/index.js";
import { MASKED_ACCOUNT_RE, normalizeBody } from "../src/parser/field-extract.js";

const EPOCH = "1970-01-01T00:00:00.000Z";

/** Enmascara todo digito: los asuntos reales traen numeros de cuenta/monto. */
function safeSubject(s: string): string {
  return s.replace(/\d/g, "#").trim();
}

async function gmail() {
  const cfg = loadConfig();
  return createGoogleapisGmailClient({
    clientId: cfg.GMAIL_OAUTH_CLIENT_ID!,
    clientSecret: cfg.GMAIL_OAUTH_CLIENT_SECRET!,
    refreshToken: cfg.GMAIL_OAUTH_REFRESH_TOKEN!,
  });
}

async function classify(n: number) {
  const client = await gmail();
  const ids = [...new Set(await client.searchMessageIds(buildSearchQuery(EPOCH)))];
  const sample = ids.slice(0, n);

  const kinds: Record<string, number> = {};
  const ignoredReasons: Record<string, number> = {};
  const unrecognizedSubjects: Record<string, number> = {};
  const recognizedSubjects: Record<
    string,
    { kind: string; type?: string; n: number; sinMonto: number; sinCuenta: number; sinContraparte: number }
  > = {};
  // Campos que importan por tipo, para ver si los asuntos NUEVOS entran completos.
  const fieldStats: Record<string, { n: number; sinMonto: number; sinCuenta: number; sinContraparte: number }> = {};
  let mojibakeBodies = 0;
  let mojibakeCounterparties = 0;
  let needsReviewParser = 0;
  const MOJI = /Ã[-¿–—‘’“”€ŒŽŠ]|Â[ -¿]/;

  let leidos = 0;
  for (const id of sample) {
    const msg = await client.getMessage(id);
    // Sobre el buzon entero esto son ~1700 fetches: sin senal de avance no hay
    // forma de saber si progresa o si se colgo contra Gmail.
    leidos += 1;
    if (leidos % 100 === 0) console.error(`leidos ${leidos}/${sample.length}`);
    if (MOJI.test(msg.body)) mojibakeBodies += 1;
    const res = parseEmail({
      subject: msg.subject,
      body: msg.body,
      gmail_msg_id: msg.gmail_msg_id,
      gmail_thread_id: msg.gmail_thread_id,
      ts: msg.ts,
    });
    kinds[res.kind] = (kinds[res.kind] ?? 0) + 1;
    const subj = safeSubject(msg.subject);

    if (res.kind === "ignored") {
      ignoredReasons[res.reason ?? "null"] = (ignoredReasons[res.reason ?? "null"] ?? 0) + 1;
      if (res.reason === "unrecognized_subject") {
        unrecognizedSubjects[subj] = (unrecognizedSubjects[subj] ?? 0) + 1;
      }
      continue;
    }

    const type = res.kind === "transaction" ? res.type : res.kind;
    const key = `${res.kind}:${type}`;
    const bySubject = (recognizedSubjects[subj] ??= {
      kind: res.kind,
      type,
      n: 0,
      sinMonto: 0,
      sinCuenta: 0,
      sinContraparte: 0,
    });
    bySubject.n += 1;

    const stat = (fieldStats[key] ??= { n: 0, sinMonto: 0, sinCuenta: 0, sinContraparte: 0 });
    stat.n += 1;
    const bump = (campo: "sinMonto" | "sinCuenta" | "sinContraparte") => {
      stat[campo] += 1;
      bySubject[campo] += 1;
    };
    if (res.kind === "transaction") {
      if (res.amount === null || res.amount === undefined) bump("sinMonto");
      if (!res.account) bump("sinCuenta");
      if (!res.counterparty) bump("sinContraparte");
      if (res.counterparty && MOJI.test(res.counterparty)) mojibakeCounterparties += 1;
      if (res.needs_review) needsReviewParser += 1;
    } else if (res.kind === "reverso") {
      // El monto del reverso lo saca el pipeline con este mismo extractor.
      const fields = extractReversoFields(msg.body);
      if (fields.amount === null || fields.amount === undefined) bump("sinMonto");
      if (!fields.account) bump("sinCuenta");
      if (!fields.counterparty) bump("sinContraparte");
    }
  }

  console.log(
    JSON.stringify(
      {
        backlogTotal: ids.length,
        muestra: sample.length,
        kinds,
        ignoredReasons,
        cobertura: {
          procesables: sample.length - (kinds.ignored ?? 0),
          ignorados: kinds.ignored ?? 0,
          pctIgnorados: +(((kinds.ignored ?? 0) / sample.length) * 100).toFixed(1),
        },
        fieldStats,
        needsReviewParser,
        unrecognizedSubjects,
        recognizedSubjects,
        mojibake: { cuerposConMojibake: mojibakeBodies, contrapartesConMojibake: mojibakeCounterparties },
      },
      null,
      2
    )
  );
}

/**
 * Investigacion del hallazgo "transferencias sin account": mira los correos
 * REALES de transferencia enviada y responde una sola pregunta — ¿el correo
 * trae en algun lado la cuenta DEL USUARIO (la de origen), o solo la del
 * beneficiario?
 *
 * Solo estructura: nombres de label, conteos y booleanos. Ningun valor.
 */
async function transfers(n: number) {
  const client = await gmail();
  const ids = [...new Set(await client.searchMessageIds("from:produbanco subject:transferencia"))].slice(0, n);

  const LABEL_RE = /(?:^|\n)[^\S\n]*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ .]{1,28}):/g;
  const MASKED_G = new RegExp(MASKED_ACCOUNT_RE.source, "gi");
  // Anclas con las que OTROS correos de Produbanco nombran la cuenta propia.
  const ANCLAS_ORIGEN: Array<[string, RegExp]> = [
    ["cuenta origen (label)", /cuenta\s+origen/i],
    ["cuenta debito (label)", /cuenta\s+d[ée]bito/i],
    ["de la|su|tu cuenta (prosa)", /de\s+(?:la|su|tu)\s+cuenta/i],
    ["desde la|su|tu cuenta (prosa)", /desde\s+(?:la|su|tu)\s+cuenta/i],
    ["en tu cuenta (prosa)", /en\s+tu\s+cuenta/i],
    ["banco origen (label)", /banco\s+origen/i],
    ["cuenta destino (label)", /cuenta\s+destino/i],
    ["cuenta beneficiario (label)", /cuenta\s+beneficiario/i],
  ];

  const porAsunto: Record<
    string,
    {
      n: number;
      labels: Record<string, number>;
      anclas: Record<string, number>;
      /** Cuantos tokens de cuenta enmascarada DISTINTOS trae el cuerpo. */
      cuentasDistintas: Record<string, number>;
      /** Forma del valor de `Cuenta Destino` cuando no trae token enmascarado. */
      formaSinMascara: Record<string, number>;
      /** El token del cuerpo, ¿es el mismo que el de `Cuenta Destino`? */
      tokenEsElDeDestino: { si: number; no: number; sinDestino: number };
      parser: Record<string, number>;
    }
  > = {};

  for (const id of ids) {
    const msg = await client.getMessage(id);
    const subj = safeSubject(msg.subject);
    // Agrupo por plantilla, no por asunto literal: el monto enmascarado los
    // volveria todos distintos.
    const plantilla = subj.replace(/\s*(por\s+)?\$?\s*[#.,]+\s*/gi, " ").replace(/\s+/g, " ").trim();
    const body = normalizeBody(msg.body);
    const g = (porAsunto[plantilla] ??= {
      n: 0,
      labels: {},
      anclas: {},
      cuentasDistintas: {},
      formaSinMascara: {},
      tokenEsElDeDestino: { si: 0, no: 0, sinDestino: 0 },
      parser: {},
    });
    g.n += 1;

    for (const m of body.matchAll(LABEL_RE)) {
      const label = m[1].trim();
      g.labels[label] = (g.labels[label] ?? 0) + 1;
    }
    for (const [nombre, re] of ANCLAS_ORIGEN) {
      if (re.test(body)) g.anclas[nombre] = (g.anclas[nombre] ?? 0) + 1;
    }

    const tokens = [...new Set((body.match(MASKED_G) ?? []).map((t) => t.toLowerCase()))];
    const k = String(tokens.length);
    g.cuentasDistintas[k] = (g.cuentasDistintas[k] ?? 0) + 1;

    // Cuando el valor de `Cuenta Destino` NO trae token enmascarado, la forma
    // del valor es lo unico que dice si el parser esta perdiendo algo. Se
    // reporta la FORMA (digitos -> #, letras -> A), nunca el valor.
    const crudo = body.match(/cuenta\s+(?:destino|beneficiario)\s*:?\s*([^\n]{0,40})/i)?.[1]?.trim();
    if (crudo !== undefined && !MASKED_ACCOUNT_RE.test(crudo)) {
      const forma = crudo.replace(/[0-9]/g, "#").replace(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "A").replace(/A+/g, "A").replace(/#+/g, "#");
      g.formaSinMascara[forma || "(vacio)"] = (g.formaSinMascara[forma || "(vacio)"] ?? 0) + 1;
    }

    // ¿El unico token del cuerpo es el que sigue a `Cuenta Destino`/`Cuenta
    // Beneficiario`? Si si, no hay ninguna otra cuenta que pudiera ser la propia.
    const destino = body.match(/cuenta\s+(?:destino|beneficiario)\s*:?\s*([^\n]{0,60})/i)?.[1];
    const tokenDestino = destino?.match(MASKED_ACCOUNT_RE)?.[0]?.toLowerCase();
    if (!tokenDestino) g.tokenEsElDeDestino.sinDestino += 1;
    else if (tokens.length === 1 && tokens[0] === tokenDestino) g.tokenEsElDeDestino.si += 1;
    else g.tokenEsElDeDestino.no += 1;

    const res = parseEmail({
      subject: msg.subject,
      body: msg.body,
      gmail_msg_id: msg.gmail_msg_id,
      gmail_thread_id: msg.gmail_thread_id,
      ts: msg.ts,
    });
    const etiqueta =
      res.kind === "transaction" ? `${res.type}/${res.account ? "conCuenta" : "sinCuenta"}` : `${res.kind}:${res.reason ?? ""}`;
    g.parser[etiqueta] = (g.parser[etiqueta] ?? 0) + 1;
  }

  console.log(JSON.stringify({ correos: ids.length, porAsunto }, null, 2));
}

async function sync(target: number) {
  const cfg = loadConfig();
  const db = openDb();
  const runner = buildProductionSyncRunner(cfg, () => db);
  if (!runner) {
    console.error("runner null: faltan credenciales");
    process.exitCode = 1;
    return;
  }
  try {
    let last: Awaited<ReturnType<typeof runner>> | undefined;
    for (let batch = 1; batch <= 40; batch += 1) {
      last = await runner({ batchSize: 25 });
      console.error(
        `lote ${batch}: seen=${last.seen} ins=${last.inserted} skip=${last.skipped} rev=${last.reversalsApplied} | acum ${last.progress.processed}/${last.progress.total}`
      );
      if (last.progress.complete || last.progress.processed >= target) break;
    }
    console.log(JSON.stringify({ cumulative: last?.cumulative, progress: last?.progress }, null, 2));
  } finally {
    db.close();
  }
}

/**
 * Drena el backlog ENTERO: mismo runner de produccion, en lotes de 45s (el
 * tope de produccion), reabriendo el handle en cada lote no — un solo proceso
 * y un solo handle, pero cada lote persiste antes de seguir, asi que matar
 * esto en cualquier momento no pierde trabajo.
 *
 * Un lote que revienta (red, cuota de Gmail, Claude) no aborta el drenado: se
 * cuenta, se espera, y se reintenta el mismo lote. Los ids no avanzan si el
 * lote fallo, asi que no se saltea nada.
 */
async function drain() {
  const cfg = loadConfig();
  const db = openDb();
  const runner = buildProductionSyncRunner(cfg, () => db);
  if (!runner) {
    console.error("runner null: faltan credenciales");
    process.exitCode = 1;
    return;
  }
  let fallosSeguidos = 0;
  let fallosTotales = 0;
  try {
    let last: Awaited<ReturnType<typeof runner>> | undefined;
    for (let batch = 1; batch <= 5000; batch += 1) {
      try {
        last = await runner({});
        fallosSeguidos = 0;
      } catch (err) {
        fallosSeguidos += 1;
        fallosTotales += 1;
        console.error(`lote ${batch}: ERROR (${fallosSeguidos} seguidos) ${String(err).slice(0, 200)}`);
        if (fallosSeguidos >= 10) {
          console.error("10 fallos seguidos: abandono el drenado");
          break;
        }
        await new Promise((r) => setTimeout(r, 5000 * fallosSeguidos));
        continue;
      }
      console.error(
        `lote ${batch}: seen=${last.seen} ins=${last.inserted} skip=${last.skipped} rev=${last.reversalsApplied} | acum ${last.progress.processed}/${last.progress.total} rest=${last.progress.remaining}`
      );
      if (last.progress.complete) break;
      // Un lote que no avanzo nada (seen=0) con backlog pendiente seria un
      // loop infinito; se corta y se reporta.
      if (last.seen === 0) {
        console.error("lote sin avance con backlog pendiente: corto");
        break;
      }
    }
    console.log(JSON.stringify({ cumulative: last?.cumulative, progress: last?.progress, fallosTotales }, null, 2));
  } finally {
    db.close();
  }
}

/** Foto de la base: solo conteos y agregados, ningun valor personal. */
function stats() {
  const db = openDb();
  try {
    const q = <T>(sql: string): T[] => db.prepare(sql).all() as T[];
    const one = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
    const progreso = db.prepare("SELECT since_ts, started_at, total, processed, updated_at FROM sync_progress").get();
    const estado = db.prepare("SELECT last_sync_ts, last_history FROM sync_state").get() as
      | { last_sync_ts: string | null; last_history: string | null }
      | undefined;
    console.log(
      JSON.stringify(
        {
          transacciones: one("SELECT COUNT(*) n FROM transactions"),
          porTipo: q("SELECT type, COUNT(*) n, SUM(amount = 0) enCero, SUM(account IS NULL) sinCuenta, SUM(needs_review) review FROM transactions GROUP BY type ORDER BY n DESC"),
          porDireccion: q("SELECT direction, COUNT(*) n FROM transactions GROUP BY direction"),
          recibidos: {
            total: one("SELECT COUNT(*) n FROM transactions WHERE type = 'recibido'"),
            conMonto: one("SELECT COUNT(*) n FROM transactions WHERE type = 'recibido' AND amount > 0"),
            enCero: one("SELECT COUNT(*) n FROM transactions WHERE type = 'recibido' AND amount = 0"),
          },
          cuentas: {
            pobladas: one("SELECT COUNT(*) n FROM transactions WHERE account IS NOT NULL AND account <> ''"),
            vacias: one("SELECT COUNT(*) n FROM transactions WHERE account IS NULL OR account = ''"),
            distintas: one("SELECT COUNT(DISTINCT account) n FROM transactions WHERE account IS NOT NULL"),
          },
          montoCero: one("SELECT COUNT(*) n FROM transactions WHERE amount = 0"),
          needsReview: one("SELECT COUNT(*) n FROM transactions WHERE needs_review = 1"),
          reversados: one("SELECT COUNT(*) n FROM transactions WHERE is_reversed = 1"),
          internas: one("SELECT COUNT(*) n FROM transactions WHERE is_internal = 1"),
          contraparteVacia: one("SELECT COUNT(*) n FROM transactions WHERE counterparty IS NULL OR counterparty = ''"),
          // Mojibake: el patron latin-1 clasico sobre texto que si se guarda.
          mojibakeContraparte: one("SELECT COUNT(*) n FROM transactions WHERE counterparty LIKE '%Ã%' OR counterparty LIKE '%Â%'"),
          estadosDeCuenta: one("SELECT COUNT(*) n FROM statements"),
          rangoFechas: db.prepare("SELECT MIN(ts) desde, MAX(ts) hasta FROM transactions").get(),
          porMes: q("SELECT substr(ts, 1, 7) mes, COUNT(*) n FROM transactions GROUP BY mes ORDER BY mes"),
          syncProgress: progreso ?? null,
          syncState: estado ? { last_sync_ts: estado.last_sync_ts, last_history: JSON.parse(estado.last_history ?? "null") } : null,
        },
        null,
        2
      )
    );
  } finally {
    db.close();
  }
}

const [cmd, arg] = process.argv.slice(2);
const n = Number(arg ?? "0") || 100;
if (cmd === "classify") await classify(n);
else if (cmd === "transfers") await transfers(n);
else if (cmd === "sync") await sync(n);
else if (cmd === "drain") await drain();
else if (cmd === "stats") stats();
else {
  console.error("uso: fase2-verify.ts classify <n> | transfers <n> | sync <n> | drain | stats");
  process.exitCode = 1;
}
